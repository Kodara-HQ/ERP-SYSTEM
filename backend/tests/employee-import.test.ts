import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import ExcelJS from 'exceljs';
import { createApp } from '../src/app';
import { pool } from '../src/database/pool';
import { execute, queryOne, scalar } from '../src/database/query';
import { seedOrganisation } from '../src/database/seed';
import type { RowDataPacket } from '../src/database/rows';
import { auth, closePool, createAccount, login, resetDatabase } from './helpers';

const app = createApp();

beforeEach(async () => {
  await resetDatabase();
  await seedOrganisation();
  const company = await queryOne<RowDataPacket>(pool, 'SELECT id FROM companies ORDER BY id LIMIT 1');
  await execute(pool, `INSERT INTO branches (company_id, code, name, status) VALUES (?, 'HQ', 'Head Office', 'active')`, [company!.id]);
});

afterAll(async () => {
  await closePool();
});

const headings = ['First name*', 'Last name*', 'Employment type*', 'Department*', 'Position*', 'Branch*', 'Start date*', 'Supervisor', 'Work email', 'Phone', 'Basic salary'];

async function workbook(rows: unknown[][]): Promise<string> {
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet('Employees');
  sheet.addRow(headings);
  for (const row of rows) sheet.addRow(row);
  return Buffer.from(await book.xlsx.writeBuffer()).toString('base64');
}

describe('employee spreadsheet import', () => {
  it('checks a file row by row, saves nothing until every row is valid, then imports it all', async () => {
    await createAccount('hr', 'HR_MANAGER');
    await createAccount('ops', 'OPERATIONS_MANAGER');
    const hr = await login(app, 'hr');
    const ops = await login(app, 'ops');

    const template = await request(app).get('/api/v1/employees/import/template.xlsx').set(auth(hr)).buffer(true).parse((res, done) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => done(null, Buffer.concat(chunks)));
    });
    expect(template.status).toBe(200);
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(template.body as ArrayBuffer);
    expect(book.worksheets.map((sheet) => sheet.name)).toEqual(['Employees', 'Instructions', 'Departments', 'Positions', 'Branches']);
    expect((await request(app).get('/api/v1/employees/import/template.xlsx').set(auth(ops))).status).toBe(403);

    const mixed = await workbook([
      ['Ama', 'Mensah', 'permanent', 'OPS', 'OPS-MANAGER', 'HQ', new Date(Date.UTC(2026, 0, 5)), '', 'ama@bajogo.test', '0244123456', 6000],
      ['Kofi', 'Boateng', 'permanent', 'Nowhere', 'DRIVER', 'HQ', '2026-02-01', '', '', '', ''],
      ['', 'Owusu', 'contractor', 'OPS-HAUL', 'DRIVER', 'HQ', '', '', '', '', ''],
    ]);
    const check = await request(app).post('/api/v1/employees/import').set(auth(hr)).send({ fileName: 'staff.xlsx', contentBase64: mixed });
    expect(check.status).toBe(200);
    expect(check.body.data).toMatchObject({ committed: false, total: 3, valid: 1, failed: 2 });
    expect(check.body.data.rows[1].errors).toContain('Department “Nowhere” was not found.');
    expect(check.body.data.rows[2].errors).toEqual(expect.arrayContaining(['First name is required.', 'Start date is required.']));
    const refused = await request(app).post('/api/v1/employees/import').set(auth(hr)).send({ fileName: 'staff.xlsx', contentBase64: mixed, commit: true });
    expect(refused.body.data.committed).toBe(false);
    expect(await scalar(pool, 'SELECT COUNT(*) FROM employees')).toBe(0);

    const clean = await workbook([
      ['Ama', 'Mensah', 'permanent', 'OPS', 'Operations Manager', 'Head Office', '05/01/2026', '', 'ama@bajogo.test', '0244123456', '6,000'],
      ['Kofi', 'Boateng', 'Fixed term', 'OPS-HAUL', 'DRIVER', 'HQ', '2026-02-01', 'ama@bajogo.test', 'kofi@bajogo.test', '', ''],
    ]);
    const imported = await request(app).post('/api/v1/employees/import').set(auth(hr)).send({ fileName: 'staff.xlsx', contentBase64: clean, commit: true });
    expect(imported.body.data).toMatchObject({ committed: true, total: 2, valid: 2, failed: 0 });
    expect(imported.body.data.rows[0].employeeNumber).toMatch(/^BJG-EMP-/);
    const kofi = await queryOne<RowDataPacket>(pool, `SELECT ea.supervisor_employee_id, ea.start_date FROM employees e JOIN employee_assignments ea ON ea.employee_id = e.id WHERE e.last_name = 'Boateng'`);
    const ama = await queryOne<RowDataPacket>(pool, `SELECT e.id, ea.start_date FROM employees e JOIN employee_assignments ea ON ea.employee_id = e.id WHERE e.last_name = 'Mensah'`);
    expect(Number(kofi!.supervisor_employee_id)).toBe(Number(ama!.id));
    expect(String(ama!.start_date)).toBe('2026-01-05');
    expect(await scalar(pool, `SELECT COUNT(*) FROM employee_compensation WHERE basic_salary = 6000`)).toBe(1);
    expect(await scalar(pool, `SELECT COUNT(*) FROM audit_logs WHERE action = 'employee.import'`)).toBe(1);
    expect(await scalar(pool, `SELECT COUNT(*) FROM audit_logs WHERE action = 'employee.create'`)).toBe(2);

    const again = await request(app).post('/api/v1/employees/import').set(auth(hr)).send({ fileName: 'staff.xlsx', contentBase64: clean });
    expect(again.body.data.rows[0].errors[0]).toMatch(/already exists/);

    const csv = Buffer.from('First name,Last name,Employment type,Department,Position,Branch,Start date\nEsi,Asante,casual,OPS-STORES,STOREKEEPER,HQ,2026-03-01\n').toString('base64');
    const fromCsv = await request(app).post('/api/v1/employees/import').set(auth(hr)).send({ fileName: 'more.csv', contentBase64: csv, commit: true });
    expect(fromCsv.body.data).toMatchObject({ committed: true, valid: 1 });
    expect((await request(app).post('/api/v1/employees/import').set(auth(ops)).send({ fileName: 'more.csv', contentBase64: csv })).status).toBe(403);
    const wrong = await request(app).post('/api/v1/employees/import').set(auth(hr)).send({ fileName: 'staff.pdf', contentBase64: csv });
    expect(wrong.status).toBe(422);
  });
});
