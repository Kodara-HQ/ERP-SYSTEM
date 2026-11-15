import { createHash } from 'crypto';
import { Readable } from 'stream';
import ExcelJS from 'exceljs';
import { ZodError } from 'zod';
import type { RowDataPacket } from '../../database/rows';
import { execute, query, queryOne, withTransaction } from '../../database/query';
import type { Db } from '../../database/query';
import { pool } from '../../database/pool';
import { writeAudit } from '../../services/auditService';
import { requireCompanyId } from '../../services/companyContext';
import type { AuthContext } from '../../types/auth';
import { HttpError } from '../../utils/httpError';
import { employeeCreateSchema } from './employees.schema';
import { insertEmployee } from './employees.service';

type Actor = { userId: number; ipAddress: string | null; userAgent: string | null };

const MAX_BYTES = 5 * 1024 * 1024;
const MAX_ROWS = 2000;

/** Spreadsheet columns, in template order. `key` is the field the form uses. */
const columns: Array<{ header: string; key: string; required?: boolean; note: string }> = [
  { header: 'First name', key: 'firstName', required: true, note: 'Required.' },
  { header: 'Last name', key: 'lastName', required: true, note: 'Required.' },
  { header: 'Other names', key: 'otherNames', note: 'Optional.' },
  { header: 'Employment type', key: 'employmentType', required: true, note: 'permanent, fixed_term, temporary, casual, or intern.' },
  { header: 'Department', key: 'department', required: true, note: 'Code or name from the Departments sheet.' },
  { header: 'Position', key: 'position', required: true, note: 'Code or title from the Positions sheet.' },
  { header: 'Branch', key: 'branch', required: true, note: 'Code or name from the Branches sheet.' },
  { header: 'Start date', key: 'assignmentStartDate', required: true, note: 'YYYY-MM-DD, or a date cell.' },
  { header: 'Supervisor', key: 'supervisor', note: 'Employee number or work email of the supervisor. Can be someone earlier in this file.' },
  { header: 'Employment status', key: 'employmentStatus', note: 'active (default), probation, or suspended.' },
  { header: 'Work email', key: 'workEmail', note: 'Optional. Must be unique.' },
  { header: 'Personal email', key: 'personalEmail', note: 'Optional.' },
  { header: 'Phone', key: 'phone', note: 'Optional. Used for salary SMS.' },
  { header: 'Date of birth', key: 'dateOfBirth', note: 'Optional. YYYY-MM-DD.' },
  { header: 'Gender', key: 'gender', note: 'female, male, other, or undisclosed.' },
  { header: 'National ID', key: 'nationalId', note: 'Optional. Stored as confidential.' },
  { header: 'Basic salary', key: 'basicSalary', note: 'Optional. Only HR with payroll access may set it.' },
  { header: 'Allowances', key: 'allowances', note: 'Optional.' },
];

export interface ImportRowResult {
  row: number;
  name: string;
  status: 'ok' | 'error';
  errors: string[];
  employeeNumber?: string;
}

function iso(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

function cellText(value: ExcelJS.CellValue): string {
  if (value == null) return '';
  if (value instanceof Date) return iso(value);
  if (typeof value === 'object') {
    if ('text' in value && typeof value.text === 'string') return value.text.trim();
    if ('result' in value) return cellText(value.result as ExcelJS.CellValue);
    if ('richText' in value) return value.richText.map((part) => part.text).join('').trim();
    if ('hyperlink' in value && 'text' in value) return String(value.text).trim();
  }
  return String(value).trim();
}

/** Accepts 15/11/2026 and 2026-11-15 as well as real date cells. */
function normaliseDate(value: string): string {
  if (!value) return value;
  const dayFirst = value.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (dayFirst) return `${dayFirst[3]}-${dayFirst[2]!.padStart(2, '0')}-${dayFirst[1]!.padStart(2, '0')}`;
  return value.slice(0, 10);
}

function normaliseHeader(value: string): string {
  return value.toLowerCase().replace(/[^a-z]/g, '');
}

async function readSheet(fileName: string, contentBase64: string): Promise<{ rows: Array<{ row: number; values: Record<string, string> }>; sha256: string }> {
  if (!/^[A-Za-z0-9+/=\r\n]+$/.test(contentBase64)) throw new HttpError(422, 'The file content is not valid.', 'INVALID_FILE');
  const buffer = Buffer.from(contentBase64, 'base64');
  if (buffer.length === 0) throw new HttpError(422, 'The file is empty.', 'INVALID_FILE');
  if (buffer.length > MAX_BYTES) throw new HttpError(413, 'The file can be at most 5 MB.', 'FILE_TOO_LARGE');
  const workbook = new ExcelJS.Workbook();
  const lower = fileName.toLowerCase();
  let sheet: ExcelJS.Worksheet | undefined;
  try {
    if (lower.endsWith('.csv')) {
      sheet = await workbook.csv.read(Readable.from(buffer.toString('utf8').replace(/^﻿/, '')));
    } else if (lower.endsWith('.xlsx')) {
      await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
      sheet = workbook.getWorksheet('Employees') ?? workbook.worksheets[0];
    } else {
      throw new HttpError(422, 'Upload the Excel template (.xlsx) or a CSV file.', 'INVALID_FILE');
    }
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(422, 'The file could not be read. Save it again as .xlsx or .csv.', 'INVALID_FILE');
  }
  if (!sheet) throw new HttpError(422, 'The file has no sheet with employees.', 'INVALID_FILE');

  const headerRow = sheet.getRow(1);
  const keyByColumn = new Map<number, string>();
  headerRow.eachCell((cell, column) => {
    const header = normaliseHeader(cellText(cell.value).replace(/\*$/, ''));
    const match = columns.find((item) => normaliseHeader(item.header) === header);
    if (match) keyByColumn.set(column, match.key);
  });
  const missing = columns.filter((item) => item.required && ![...keyByColumn.values()].includes(item.key)).map((item) => item.header);
  if (missing.length) throw new HttpError(422, `The first row must have the template headings. Missing: ${missing.join(', ')}.`, 'INVALID_HEADINGS');

  const rows: Array<{ row: number; values: Record<string, string> }> = [];
  sheet.eachRow((row, number) => {
    if (number === 1) return;
    const values: Record<string, string> = {};
    for (const [column, key] of keyByColumn) values[key] = cellText(row.getCell(column).value);
    if (Object.values(values).every((value) => value === '')) return;
    rows.push({ row: number, values });
  });
  if (rows.length === 0) throw new HttpError(422, 'The file has no employee rows under the headings.', 'EMPTY_FILE');
  if (rows.length > MAX_ROWS) throw new HttpError(422, `Import at most ${MAX_ROWS} employees at a time.`, 'TOO_MANY_ROWS');
  return { rows, sha256: createHash('sha256').update(buffer).digest('hex') };
}

interface Lookups {
  departments: RowDataPacket[];
  positions: RowDataPacket[];
  branches: RowDataPacket[];
}

async function lookups(db: Db, companyId: number): Promise<Lookups> {
  return {
    departments: await query<RowDataPacket[]>(db, `SELECT id, code, name FROM departments WHERE company_id = ? AND status = 'active' AND deleted_at IS NULL`, [companyId]),
    positions: await query<RowDataPacket[]>(db, `SELECT id, code, title, department_id FROM positions WHERE company_id = ? AND status = 'active'`, [companyId]),
    branches: await query<RowDataPacket[]>(db, `SELECT id, code, name FROM branches WHERE company_id = ? AND status = 'active'`, [companyId]),
  };
}

function find(rows: RowDataPacket[], value: string, nameColumn: string, label: string, errors: string[], filter?: (row: RowDataPacket) => boolean): number | undefined {
  const wanted = value.trim().toLowerCase();
  if (!wanted) return undefined;
  const pool = filter ? rows.filter(filter) : rows;
  const matches = pool.filter((row) => String(row.code).toLowerCase() === wanted || String(row[nameColumn]).toLowerCase() === wanted);
  if (matches.length === 1) return Number(matches[0]!.id);
  if (matches.length > 1) errors.push(`${label} “${value}” matches more than one record. Use the code.`);
  else errors.push(`${label} “${value}” was not found.`);
  return undefined;
}

async function supervisorId(db: Db, value: string, errors: string[]): Promise<number | null> {
  if (!value) return null;
  const row = await queryOne<RowDataPacket>(
    db,
    `SELECT id FROM employees WHERE deleted_at IS NULL AND (employee_number = ? OR LOWER(work_email) = ?)`,
    [value.trim(), value.trim().toLowerCase()],
  );
  if (!row) {
    errors.push(`Supervisor “${value}” was not found. Use their employee number or work email.`);
    return null;
  }
  return Number(row.id);
}

const lookedUp = new Set(['departmentId', 'positionId', 'branchId', 'supervisorEmployeeId']);

/** Form validation messages in spreadsheet terms. Looked-up columns report their own errors. */
function zodMessages(error: ZodError): string[] {
  const label = (path: string) => columns.find((item) => item.key === path)?.header ?? path;
  return error.issues
    .filter((issue) => !lookedUp.has(String(issue.path[0] ?? '')))
    .map((issue) => {
      const field = label(String(issue.path[0] ?? ''));
      return issue.code === 'invalid_type' && issue.received === 'undefined' ? `${field} is required.` : `${field}: ${issue.message}`;
    });
}

class Rollback extends Error {}

/**
 * Checks or imports a spreadsheet of employees. Every row goes through the same rules as the
 * registration form inside one transaction. Nothing is saved unless `commit` is set and every row is
 * valid, so a file is imported completely or not at all.
 */
export async function importEmployees(auth: AuthContext, input: { fileName: string; contentBase64: string; commit: boolean }, actor: Actor) {
  const { rows, sha256 } = await readSheet(input.fileName, input.contentBase64);
  const results: ImportRowResult[] = [];
  let committed = false;
  try {
    await withTransaction(async (connection) => {
      const companyId = await requireCompanyId(connection);
      const reference = await lookups(connection, companyId);
      for (const { row, values } of rows) {
        const errors: string[] = [];
        const name = `${values.firstName ?? ''} ${values.lastName ?? ''}`.trim() || '(no name)';
        const departmentId = find(reference.departments, values.department ?? '', 'name', 'Department', errors);
        const positionId = find(reference.positions, values.position ?? '', 'title', 'Position', errors,
          departmentId ? (item) => item.department_id == null || Number(item.department_id) === departmentId : undefined);
        const branchId = find(reference.branches, values.branch ?? '', 'name', 'Branch', errors);
        const supervisor = await supervisorId(connection, values.supervisor ?? '', errors);
        const candidate = {
          firstName: values.firstName || undefined,
          lastName: values.lastName || undefined,
          otherNames: values.otherNames || null,
          workEmail: values.workEmail || null,
          personalEmail: values.personalEmail || null,
          phone: values.phone || null,
          dateOfBirth: values.dateOfBirth ? normaliseDate(values.dateOfBirth) : null,
          gender: values.gender ? values.gender.toLowerCase() : null,
          nationalId: values.nationalId || null,
          employmentStatus: values.employmentStatus ? values.employmentStatus.toLowerCase() : undefined,
          employmentType: values.employmentType ? values.employmentType.toLowerCase().replace(/[\s-]+/g, '_') : undefined,
          departmentId: departmentId ?? 0,
          positionId: positionId ?? 0,
          branchId: branchId ?? 0,
          supervisorEmployeeId: supervisor,
          assignmentStartDate: values.assignmentStartDate ? normaliseDate(values.assignmentStartDate) : undefined,
          basicSalary: values.basicSalary ? Number(values.basicSalary.replace(/,/g, '')) : null,
          allowances: values.allowances ? Number(values.allowances.replace(/,/g, '')) : null,
        };
        for (const [key, label] of [['department', 'Department'], ['position', 'Position'], ['branch', 'Branch']] as const) {
          if (!values[key]) errors.push(`${label} is required.`);
        }
        const parsed = employeeCreateSchema.safeParse(candidate);
        if (!parsed.success) errors.push(...zodMessages(parsed.error));
        if (errors.length > 0 || !parsed.success) {
          results.push({ row, name, status: 'error', errors: [...new Set(errors)] });
          continue;
        }
        await execute(connection, 'SAVEPOINT import_row');
        try {
          const saved = await insertEmployee(connection, auth, parsed.data as never, actor);
          await execute(connection, 'RELEASE SAVEPOINT import_row');
          results.push({ row, name, status: 'ok', errors: [], employeeNumber: (saved as { employeeNumber?: string }).employeeNumber });
        } catch (error) {
          await execute(connection, 'ROLLBACK TO SAVEPOINT import_row');
          const code = (error as { code?: string }).code;
          const message = error instanceof HttpError ? error.message
            : code === 'ER_DUP_ENTRY' ? 'An employee with this work email already exists.'
              : 'This row could not be saved.';
          results.push({ row, name, status: 'error', errors: [message] });
        }
      }
      const failed = results.filter((result) => result.status === 'error').length;
      if (!input.commit || failed > 0) throw new Rollback();
      await writeAudit(connection, {
        userId: actor.userId, action: 'employee.import', module: 'employees', entityType: 'employee_import', entityId: null,
        newValue: { fileName: input.fileName, sha256, imported: results.length }, ipAddress: actor.ipAddress, userAgent: actor.userAgent,
      });
      committed = true;
    });
  } catch (error) {
    if (!(error instanceof Rollback)) throw error;
  }
  const failed = results.filter((result) => result.status === 'error').length;
  return {
    committed,
    total: results.length,
    valid: results.length - failed,
    failed,
    rows: committed ? results : results.map((result) => ({ ...result, employeeNumber: undefined })),
  };
}

/** The import template, with the company's own departments, positions, and branches to copy from. */
export async function importTemplate(): Promise<Buffer> {
  const companyId = await requireCompanyId(pool);
  const reference = await lookups(pool, companyId);
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'BAJOGO ERP';
  const sheet = workbook.addWorksheet('Employees');
  sheet.addRow(columns.map((item) => (item.required ? `${item.header}*` : item.header)));
  sheet.getRow(1).font = { bold: true };
  sheet.columns.forEach((column) => { column.width = 20; });
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  const guide = workbook.addWorksheet('Instructions');
  guide.addRow(['Column', 'What to enter']);
  guide.getRow(1).font = { bold: true };
  for (const item of columns) guide.addRow([item.required ? `${item.header}*` : item.header, item.note]);
  guide.addRow([]);
  guide.addRow(['', 'Fill one employee per row on the Employees sheet. Columns marked * are required.']);
  guide.addRow(['', 'Check the file first. Nothing is saved until every row is valid and you choose Import.']);
  guide.columns = [{ width: 22 }, { width: 90 }];
  const lists: Array<[string, string[], RowDataPacket[], string[]]> = [
    ['Departments', ['Code', 'Name'], reference.departments, ['code', 'name']],
    ['Positions', ['Code', 'Title', 'Department'], reference.positions.map((row) => ({
      ...row, department: reference.departments.find((item) => Number(item.id) === Number(row.department_id))?.name ?? '',
    })) as RowDataPacket[], ['code', 'title', 'department']],
    ['Branches', ['Code', 'Name'], reference.branches, ['code', 'name']],
  ];
  for (const [title, headers, rows, keys] of lists) {
    const list = workbook.addWorksheet(title);
    list.addRow(headers);
    list.getRow(1).font = { bold: true };
    for (const row of rows) list.addRow(keys.map((key) => String(row[key] ?? '')));
    list.columns.forEach((column) => { column.width = 32; });
  }
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
