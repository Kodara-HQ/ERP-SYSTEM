import request from 'supertest';
import type { Express } from 'express';
import { pool } from '../src/database/pool';
import { seedFoundation } from '../src/database/seed';
import { execute, queryOne } from '../src/database/query';
import { hashPassword } from '../src/utils/password';
import type { RowDataPacket } from '../src/database/rows';

export const testPassword = 'TestPassword1';

const tables = [
  'website_applications',
  'website_enquiries',
  'website_product_images',
  'website_gallery',
  'website_articles',
  'website_vacancies',
  'website_items',
  'website_blocks',
  'website_products',
  'website_media',
  'website_settings',
  'department_register_entries',
  'performance_assessments',
  'department_targets',
  'department_reports',
  'announcements',
  'supporting_documents',
  'segregation_rules',
  'approval_authority_limits',
  'meeting_actions',
  'management_meetings',
  'corrective_actions',
  'management_findings',
  'departmental_reviews',
  'operational_issues',
  'operational_tasks',
  'operational_activities',
  'legal_comments',
  'legal_obligations',
  'legal_risks',
  'legal_documents',
  'sms_messages',
  'salary_payments',
  'payroll_events',
  'payroll_lines',
  'payroll_runs',
  'employee_compensation',
  'reconciliations',
  'customer_receipts',
  'customer_invoices',
  'customers',
  'budgets',
  'payment_requests',
  'journal_lines',
  'journals',
  'cash_accounts',
  'ledger_accounts',
  'supplier_invoices',
  'goods_received_lines',
  'goods_received_notes',
  'purchase_order_lines',
  'purchase_orders',
  'purchase_requisition_lines',
  'purchase_requisitions',
  'stock_movements',
  'stock_lots',
  'stock_balances',
  'stock_items',
  'stock_categories',
  'warehouses',
  'suppliers',
  'exit_records',
  'onboarding_tasks',
  'training_records',
  'appraisals',
  'disciplinary_records',
  'promotions',
  'employment_contracts',
  'applicants',
  'vacancies',
  'attendance_records',
  'leave_requests',
  'leave_balances',
  'leave_types',
  'approval_actions',
  'approval_request_steps',
  'approval_delegations',
  'approval_requests',
  'workflow_steps',
  'workflows',
  'notifications',
  'audit_logs',
  'organisational_change_requests',
  'login_attempts',
  'user_sessions',
  'user_roles',
  'reporting_relationships',
  'employee_assignments',
  'employment_records',
  'employees',
  'users',
  'role_permissions',
  'positions',
  'department_workspaces',
  'departments',
  'locations',
  'branches',
  'system_settings',
  'reference_sequences',
  'permissions',
  'roles',
  'companies',
];

export async function resetDatabase(): Promise<void> {
  await pool.query(`TRUNCATE TABLE ${tables.join(', ')} RESTART IDENTITY CASCADE`);
  await seedFoundation();
}

export async function createAccount(username: string, roleCode: string, scope?: { type: 'global' | 'department' | 'branch' | 'own'; id?: number }): Promise<number> {
  const passwordHash = await hashPassword(testPassword);
  const user = await execute(
    pool,
    `INSERT INTO users (username, email, password_hash, status, must_change_password)
     VALUES (?, ?, ?, 'active', 0)`,
    [username, `${username}@bajogo.test`, passwordHash],
  );
  const role = await queryOne<RowDataPacket>(pool, 'SELECT id FROM roles WHERE code = ?', [roleCode]);
  if (!role) {
    throw new Error(`Missing role ${roleCode}`);
  }
  await execute(pool, 'INSERT INTO user_roles (user_id, role_id, scope_type, scope_id) VALUES (?, ?, ?, ?)', [
    user.insertId,
    role.id,
    scope?.type ?? 'global',
    scope?.id ?? null,
  ]);
  return user.insertId;
}

export async function login(app: Express, username: string): Promise<string> {
  const response = await request(app).post('/api/v1/auth/login').send({ username, password: testPassword });
  if (response.status !== 200) {
    throw new Error(`Login failed for ${username}: ${response.status} ${JSON.stringify(response.body)}`);
  }
  return response.body.data.accessToken as string;
}

export function auth(token: string): { Authorization: string } {
  return { Authorization: `Bearer ${token}` };
}

export async function closePool(): Promise<void> {
  await pool.end();
}
