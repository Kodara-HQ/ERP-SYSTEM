import type { RowDataPacket } from '../../database/rows';
import { pool } from '../../database/pool';
import { query } from '../../database/query';
import type { ReportTable } from '../../services/reportFiles';
import { hasPermission } from '../../services/access';
import type { AuthContext } from '../../types/auth';
import { HttpError } from '../../utils/httpError';
import { addDays } from '../../utils/pagination';
import { financeReportTables, financeSummary } from '../finance/finance.service';
import { hrReportTables, hrSummary } from '../hr/hr.service';
import { payrollReport, payrollReportTables } from '../payroll/payroll.service';
import { inventoryReportTables, inventorySummary, procurementReportTables, procurementSummary } from '../supply/supply.service';

export interface Range { from: string; to: string }

interface ReportType {
  code: string;
  name: string;
  description: string;
  permission: string;
  build: (auth: AuthContext, range: Range) => Promise<ReportTable[]>;
}

const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function ordinal(day: number): string {
  const teen = day % 100 >= 11 && day % 100 <= 13;
  const suffix = teen ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[day % 10] ?? 'th';
  return `${day}${suffix}`;
}

/** 2026-11-10 → "10th November 2026". */
export function longDate(iso: string): string {
  const [year, month, day] = iso.slice(0, 10).split('-').map(Number);
  return `${ordinal(day)} ${months[month - 1]} ${year}`;
}

/** "10th November 2026 - 5th December 2026". */
export function periodLabel(range: Range): string {
  return `${longDate(range.from)} - ${longDate(range.to)}`;
}

const day = (value: unknown) => (value == null ? '' : longDate(new Date(value as string).toISOString()));
const num = (value: unknown) => Number(value ?? 0);
/** Timestamps are compared against [from, to + 1 day) so the whole last day counts. */
const between = (range: Range) => [range.from, addDays(range.to, 1)];

async function approvalsTables(_auth: AuthContext, range: Range): Promise<ReportTable[]> {
  const rows = await query<RowDataPacket[]>(
    pool,
    `SELECT r.reference_number, r.title, w.name AS workflow, d.name AS department, r.amount, r.status, r.submitted_at, r.decided_at
     FROM approval_requests r
     JOIN workflows w ON w.id = r.workflow_id
     LEFT JOIN departments d ON d.id = r.department_id
     WHERE r.submitted_at >= ? AND r.submitted_at < ?
     ORDER BY r.submitted_at`,
    between(range),
  );
  const byStatus = new Map<string, { count: number; amount: number }>();
  for (const row of rows) {
    const entry = byStatus.get(String(row.status)) ?? { count: 0, amount: 0 };
    entry.count += 1;
    entry.amount += num(row.amount);
    byStatus.set(String(row.status), entry);
  }
  return [
    {
      title: 'Requests by status',
      columns: ['Status', 'Requests', 'Amount'],
      rows: [...byStatus.entries()].map(([status, entry]) => [status.replaceAll('_', ' '), entry.count, Number(entry.amount.toFixed(2))]),
    },
    {
      title: 'Requests submitted',
      columns: ['Reference', 'Title', 'Workflow', 'Department', 'Amount', 'Status', 'Submitted', 'Decided'],
      rows: rows.map((row) => [
        String(row.reference_number), String(row.title), String(row.workflow), row.department ? String(row.department) : '',
        row.amount == null ? '' : num(row.amount), String(row.status).replaceAll('_', ' '), day(row.submitted_at), day(row.decided_at),
      ]),
    },
  ];
}

async function operationsTables(_auth: AuthContext, range: Range): Promise<ReportTable[]> {
  const activities = await query<RowDataPacket[]>(
    pool,
    `SELECT a.activity_date, a.area, d.name AS department, a.summary
     FROM operational_activities a JOIN departments d ON d.id = a.department_id
     WHERE a.activity_date BETWEEN ? AND ?
     ORDER BY a.activity_date`,
    [range.from, range.to],
  );
  const issues = await query<RowDataPacket[]>(
    pool,
    `SELECT i.reference_number, i.title, i.area, d.name AS department, i.severity, i.status, i.escalated, i.created_at
     FROM operational_issues i JOIN departments d ON d.id = i.department_id
     WHERE i.created_at >= ? AND i.created_at < ?
     ORDER BY i.created_at`,
    between(range),
  );
  return [
    {
      title: 'Activities',
      columns: ['Date', 'Area', 'Department', 'Summary'],
      rows: activities.map((row) => [day(row.activity_date), String(row.area), String(row.department), String(row.summary)]),
    },
    {
      title: 'Issues raised',
      columns: ['Reference', 'Issue', 'Area', 'Department', 'Severity', 'Status', 'Escalated', 'Raised'],
      rows: issues.map((row) => [
        String(row.reference_number), String(row.title), String(row.area), String(row.department),
        String(row.severity), String(row.status), num(row.escalated) ? 'Yes' : 'No', day(row.created_at),
      ]),
    },
  ];
}

async function executiveTables(_auth: AuthContext, range: Range): Promise<ReportTable[]> {
  const reviews = await query<RowDataPacket[]>(
    pool,
    `SELECT r.reference_number, r.review_date, d.name AS department, r.status, r.summary
     FROM departmental_reviews r JOIN departments d ON d.id = r.department_id
     WHERE r.review_date BETWEEN ? AND ?
     ORDER BY r.review_date`,
    [range.from, range.to],
  );
  const actions = await query<RowDataPacket[]>(
    pool,
    `SELECT a.reference_number, a.title, d.name AS department, u.username AS assignee, a.due_on, a.status
     FROM corrective_actions a
     JOIN departments d ON d.id = a.department_id
     JOIN users u ON u.id = a.assigned_to_user_id
     WHERE a.created_at >= ? AND a.created_at < ?
     ORDER BY a.due_on`,
    between(range),
  );
  return [
    {
      title: 'Department checks',
      columns: ['Reference', 'Date', 'Department', 'Status', 'Summary'],
      rows: reviews.map((row) => [String(row.reference_number), day(row.review_date), String(row.department), String(row.status), String(row.summary)]),
    },
    {
      title: 'Corrective actions',
      columns: ['Reference', 'Action', 'Department', 'Assigned to', 'Due', 'Status'],
      rows: actions.map((row) => [String(row.reference_number), String(row.title), String(row.department), String(row.assignee), day(row.due_on), String(row.status)]),
    },
  ];
}

async function administrationTables(_auth: AuthContext, range: Range): Promise<ReportTable[]> {
  const byPerson = await query<RowDataPacket[]>(
    pool,
    `SELECT COALESCE(u.username, 'system') AS username, a.module, COUNT(*) AS total
     FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id
     WHERE a.created_at >= ? AND a.created_at < ?
     GROUP BY COALESCE(u.username, 'system'), a.module
     ORDER BY COALESCE(u.username, 'system'), a.module`,
    between(range),
  );
  const adminActions = await query<RowDataPacket[]>(
    pool,
    `SELECT a.created_at, u.username, a.action, a.module, a.entity_type, a.entity_id
     FROM audit_logs a
     JOIN users u ON u.id = a.user_id
     WHERE a.created_at >= ? AND a.created_at < ?
       AND EXISTS (
         SELECT 1 FROM user_roles ur JOIN roles r ON r.id = ur.role_id
         WHERE ur.user_id = a.user_id AND r.is_technical_admin = 1
       )
     ORDER BY a.created_at`,
    between(range),
  );
  return [
    {
      title: 'Activity by person',
      columns: ['User', 'Area', 'Actions'],
      rows: byPerson.map((row) => [String(row.username), String(row.module), num(row.total)]),
    },
    {
      title: 'System administrator actions',
      columns: ['When', 'User', 'Action', 'Area', 'Record'],
      rows: adminActions.map((row) => [
        new Date(row.created_at as string).toISOString().replace('T', ' ').slice(0, 16),
        String(row.username), String(row.action), String(row.module), `${row.entity_type} ${row.entity_id ?? ''}`.trim(),
      ]),
    },
  ];
}

async function overviewTables(auth: AuthContext, range: Range): Promise<ReportTable[]> {
  const rows: Array<Array<string | number>> = [];
  const [approvals] = await query<RowDataPacket[]>(
    pool,
    `SELECT COUNT(*) AS submitted,
            SUM(CASE WHEN status IN ('approved', 'processing', 'completed') THEN 1 ELSE 0 END) AS approved,
            SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) AS rejected,
            SUM(CASE WHEN status IN ('submitted', 'pending_review', 'under_approval') THEN 1 ELSE 0 END) AS waiting,
            SUM(CASE WHEN status IN ('approved', 'processing', 'completed') THEN COALESCE(amount, 0) ELSE 0 END) AS approved_amount
     FROM approval_requests WHERE submitted_at >= ? AND submitted_at < ?`,
    between(range),
  );
  rows.push(
    ['Approvals', 'Requests submitted', num(approvals?.submitted)],
    ['Approvals', 'Approved', num(approvals?.approved)],
    ['Approvals', 'Rejected', num(approvals?.rejected)],
    ['Approvals', 'Still waiting', num(approvals?.waiting)],
    ['Approvals', 'Amount approved', Number(num(approvals?.approved_amount).toFixed(2))],
  );
  if (hasPermission(auth, 'finance.view')) {
    const finance = await financeSummary(range);
    rows.push(
      ['Finance', 'Income', finance.profitAndLoss.income],
      ['Finance', 'Expense', finance.profitAndLoss.expense],
      ['Finance', 'Net result', finance.profitAndLoss.net],
    );
  }
  const [people] = await query<RowDataPacket[]>(
    pool,
    `SELECT
       (SELECT COUNT(*) FROM employees WHERE deleted_at IS NULL AND employment_status IN ('active', 'probation')) AS headcount,
       (SELECT COUNT(*) FROM employees WHERE deleted_at IS NULL AND hire_date BETWEEN ? AND ?) AS hires,
       (SELECT COUNT(*) FROM exit_records WHERE exit_date BETWEEN ? AND ?) AS exits`,
    [range.from, range.to, range.from, range.to],
  );
  rows.push(
    ['People', 'Current headcount', num(people?.headcount)],
    ['People', 'New hires', num(people?.hires)],
    ['People', 'Exits', num(people?.exits)],
  );
  const [ops] = await query<RowDataPacket[]>(
    pool,
    `SELECT COUNT(*) AS raised,
            SUM(CASE WHEN severity = 'high' THEN 1 ELSE 0 END) AS high,
            SUM(CASE WHEN status <> 'resolved' THEN 1 ELSE 0 END) AS unresolved
     FROM operational_issues WHERE created_at >= ? AND created_at < ?`,
    between(range),
  );
  rows.push(
    ['Operations', 'Issues raised', num(ops?.raised)],
    ['Operations', 'High-severity issues', num(ops?.high)],
    ['Operations', 'Issues not yet resolved', num(ops?.unresolved)],
  );
  const [actions] = await query<RowDataPacket[]>(
    pool,
    `SELECT COUNT(*) AS assigned,
            SUM(CASE WHEN status = 'resolved' THEN 1 ELSE 0 END) AS resolved,
            SUM(CASE WHEN status <> 'resolved' AND due_on < ? THEN 1 ELSE 0 END) AS overdue
     FROM corrective_actions WHERE created_at >= ? AND created_at < ?`,
    [range.to, ...between(range)],
  );
  rows.push(
    ['Department checks', 'Corrective actions assigned', num(actions?.assigned)],
    ['Department checks', 'Resolved', num(actions?.resolved)],
    ['Department checks', 'Overdue at period end', num(actions?.overdue)],
  );
  if (hasPermission(auth, 'audit.view')) {
    const [audit] = await query<RowDataPacket[]>(
      pool,
      'SELECT COUNT(*) AS total FROM audit_logs WHERE created_at >= ? AND created_at < ?',
      between(range),
    );
    rows.push(['System', 'Recorded actions in the audit log', num(audit?.total)]);
  }
  return [{ title: 'Key figures', columns: ['Area', 'Measure', 'Value'], rows }];
}

export const reportTypes: ReportType[] = [
  {
    code: 'overview',
    name: 'Company overview',
    description: 'Key figures across approvals, finance, people, operations and department checks.',
    permission: 'executive.review',
    build: overviewTables,
  },
  {
    code: 'finance',
    name: 'Financial report',
    description: 'Profit and loss, balance sheet, trial balance and payables.',
    permission: 'finance.view',
    build: async (_auth, range) => financeReportTables(await financeSummary(range)),
  },
  {
    code: 'approvals',
    name: 'Approvals and spending',
    description: 'Every request submitted in the period, its amount and outcome.',
    permission: 'approvals.view',
    build: approvalsTables,
  },
  {
    code: 'hr',
    name: 'People and HR',
    description: 'Headcount, leave, attendance and vacancies.',
    permission: 'hr.view',
    build: async (auth, range) => hrReportTables(await hrSummary(auth, range.from, range.to)),
  },
  {
    code: 'payroll',
    name: 'Payroll',
    description: 'Payroll runs and salary payments for the months in the period.',
    permission: 'payroll.view',
    build: async (auth, range) => {
      const fromMonth = range.from.slice(0, 7);
      const toMonth = range.to.slice(0, 7);
      const rows = (await payrollReport(auth)).filter((row) => row.period >= fromMonth && row.period <= toMonth);
      return payrollReportTables(rows);
    },
  },
  {
    code: 'procurement',
    name: 'Procurement',
    description: 'Requisitions, open orders and goods received.',
    permission: 'procurement.view',
    build: async (_auth, range) => procurementReportTables(await procurementSummary(range)),
  },
  {
    code: 'inventory',
    name: 'Stock and inventory',
    description: 'Stock value, items below reorder level, expired lots and movements.',
    permission: 'inventory.view',
    build: async (_auth, range) => inventoryReportTables(await inventorySummary(range)),
  },
  {
    code: 'operations',
    name: 'Operations',
    description: 'Daily activities recorded and issues raised.',
    permission: 'operations.view',
    build: operationsTables,
  },
  {
    code: 'executive',
    name: 'Department checks',
    description: 'Department reviews and the corrective actions assigned.',
    permission: 'executive.review',
    build: executiveTables,
  },
  {
    code: 'administration',
    name: 'System activity',
    description: 'Who did what in the system, including every system administrator action.',
    permission: 'audit.view',
    build: administrationTables,
  },
];

export function availableReports(auth: AuthContext) {
  return reportTypes
    .filter((type) => hasPermission(auth, type.permission))
    .map(({ code, name, description }) => ({ code, name, description }));
}

export async function buildReport(auth: AuthContext, code: string, range: Range) {
  const type = reportTypes.find((item) => item.code === code);
  if (!type) {
    throw new HttpError(404, 'That report does not exist.', 'REPORT_NOT_FOUND');
  }
  if (!hasPermission(auth, type.permission)) {
    throw new HttpError(403, 'You do not have permission to open this report.', 'FORBIDDEN');
  }
  if (range.from > range.to) {
    throw new HttpError(422, 'The start date must be on or before the end date.', 'INVALID_RANGE');
  }
  const tables = await type.build(auth, range);
  return {
    code: type.code,
    name: type.name,
    from: range.from,
    to: range.to,
    period: periodLabel(range),
    title: `${type.name}: ${periodLabel(range)}`,
    generatedAt: new Date().toISOString(),
    tables,
  };
}

export function reportCsv(report: Awaited<ReturnType<typeof buildReport>>): string {
  const cell = (value: string | number) => {
    const text = String(value);
    return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  };
  const lines = [cell(report.title), ''];
  for (const table of report.tables) {
    lines.push(cell(table.title), table.columns.map(cell).join(','));
    for (const row of table.rows) lines.push(row.map(cell).join(','));
    lines.push('');
  }
  return lines.join('\n');
}
