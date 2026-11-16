import fs from 'fs';
import path from 'path';
import { randomBytes } from 'crypto';
import { env } from '../config/env';
import { pool } from './pool';
import { execute, query, queryOne } from './query';
import {
  authorityLimitCatalog,
  DEFAULT_ESCALATION_HOURS,
  DEFAULT_EXECUTIVE_THRESHOLD,
  GOVERNANCE_VERSION,
  workflowCatalog,
  type WorkflowSeed,
} from '../modules/approvals/workflowCatalog';
import { segregationCatalog } from '../services/governance';
import { departmentWorkspaces, initialDepartments, initialPositions, permissionCatalog, roleCatalog } from './rbacCatalog';
import { hashPassword } from '../utils/password';
import { logger } from '../utils/logger';
import type { RowDataPacket } from './rows';

export async function seedFoundation(): Promise<void> {
  const company = await queryOne<RowDataPacket>(pool, 'SELECT id FROM companies ORDER BY id LIMIT 1');
  if (!company) {
    await execute(
      pool,
      `INSERT INTO companies (legal_name, trading_name, currency_code, timezone, fiscal_year_start_month, status)
       VALUES ('BAJOGO ENTERPRISE', 'BAJOGO ENTERPRISE', 'USD', 'UTC', 1, 'active')`,
    );
  }

  for (const permission of permissionCatalog) {
    await execute(
      pool,
      `INSERT INTO permissions (code, module, action, description, sensitivity)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE module = VALUES(module), action = VALUES(action), description = VALUES(description), sensitivity = VALUES(sensitivity)`,
      [permission.code, permission.module, permission.action, permission.description, permission.sensitivity],
    );
  }

  const permissionRows = await query<RowDataPacket[]>(pool, 'SELECT id, code FROM permissions');
  const permissionIds = new Map(permissionRows.map((row) => [String(row.code), Number(row.id)]));

  for (const role of roleCatalog) {
    await execute(
      pool,
      `INSERT INTO roles (code, name, description, is_system, is_technical_admin, can_approve_expenditure, has_final_business_authority, status)
       VALUES (?, ?, ?, 1, ?, ?, ?, 'active')
       ON DUPLICATE KEY UPDATE
         name = VALUES(name),
         description = VALUES(description),
         is_system = 1,
         is_technical_admin = VALUES(is_technical_admin),
         can_approve_expenditure = VALUES(can_approve_expenditure),
         has_final_business_authority = VALUES(has_final_business_authority)`,
      [
        role.code,
        role.name,
        role.description,
        role.isTechnicalAdmin ? 1 : 0,
        role.canApproveExpenditure ? 1 : 0,
        role.hasFinalBusinessAuthority ? 1 : 0,
      ],
    );
    const stored = await queryOne<RowDataPacket>(pool, 'SELECT id FROM roles WHERE code = ?', [role.code]);
    if (!stored) {
      throw new Error(`Role ${role.code} was not saved.`);
    }
    await execute(pool, 'DELETE FROM role_permissions WHERE role_id = ?', [stored.id]);
    for (const code of new Set(role.permissions)) {
      const permissionId = permissionIds.get(code);
      if (!permissionId) {
        throw new Error(`Permission ${code} is missing from the catalogue.`);
      }
      await execute(pool, 'INSERT INTO role_permissions (role_id, permission_id) VALUES (?, ?)', [stored.id, permissionId]);
    }
  }

  await execute(
    pool,
    `INSERT INTO reference_sequences (sequence_key, next_value) VALUES ('employee', 1), ('org_change', 1)
     ON DUPLICATE KEY UPDATE sequence_key = sequence_key`,
  );
  await execute(
    pool,
    `INSERT INTO system_settings (setting_key, setting_value) VALUES
      ('employee_number_prefix', JSON_QUOTE('BJG-EMP')),
      ('org_change_prefix', JSON_QUOTE('BJG-ORG')),
      ('approval_request_prefix', JSON_QUOTE('BJG-APR')),
      ('approval_reminder_days', '2'),
      ('supplier_prefix', JSON_QUOTE('BJG-SUP')),
      ('stock_movement_prefix', JSON_QUOTE('BJG-STK')),
      ('purchase_requisition_prefix', JSON_QUOTE('BJG-PRQ')),
      ('purchase_order_prefix', JSON_QUOTE('BJG-POR')),
      ('goods_received_prefix', JSON_QUOTE('BJG-GRN')),
      ('supplier_invoice_prefix', JSON_QUOTE('BJG-SIV')),
      ('journal_prefix', JSON_QUOTE('BJG-JNL')),
      ('payment_request_prefix', JSON_QUOTE('BJG-PAY')),
      ('budget_prefix', JSON_QUOTE('BJG-BUD')),
      ('customer_prefix', JSON_QUOTE('BJG-CUS')),
      ('customer_invoice_prefix', JSON_QUOTE('BJG-CIV')),
      ('payroll_run_prefix', JSON_QUOTE('BJG-PRL')),
      ('salary_payment_prefix', JSON_QUOTE('BJG-SAL')),
      ('legal_document_prefix', JSON_QUOTE('BJG-LEG')),
      ('legal_risk_prefix', JSON_QUOTE('BJG-RSK')),
      ('operational_activity_prefix', JSON_QUOTE('BJG-OPS')),
      ('operational_task_prefix', JSON_QUOTE('BJG-TSK')),
      ('operational_issue_prefix', JSON_QUOTE('BJG-ISS')),
      ('departmental_review_prefix', JSON_QUOTE('BJG-REV')),
      ('corrective_action_prefix', JSON_QUOTE('BJG-COR')),
      ('management_meeting_prefix', JSON_QUOTE('BJG-MTG')),
      ('department_report_prefix', JSON_QUOTE('BJG-RPT')),
      ('executive_approval_threshold', '${DEFAULT_EXECUTIVE_THRESHOLD}'),
      ('approval_escalation_hours', '${DEFAULT_ESCALATION_HOURS}'),
      ('approval_escalation_role', JSON_QUOTE('CEO'))
     ON DUPLICATE KEY UPDATE setting_key = setting_key`,
  );
  await execute(
    pool,
    `INSERT INTO reference_sequences (sequence_key, next_value) VALUES
       ('approval_request', 1),
       ('supplier', 1),
       ('stock_movement', 1),
       ('purchase_requisition', 1),
       ('purchase_order', 1),
       ('goods_received', 1),
       ('supplier_invoice', 1),
       ('journal', 1),
       ('payment_request', 1),
       ('budget', 1),
       ('customer', 1),
       ('customer_invoice', 1),
       ('payroll_run', 1),
       ('salary_payment', 1),
       ('legal_document', 1),
       ('legal_risk', 1),
       ('operational_activity', 1),
       ('operational_task', 1),
       ('operational_issue', 1),
       ('departmental_review', 1),
       ('corrective_action', 1),
       ('management_meeting', 1),
       ('department_report', 1)
     ON DUPLICATE KEY UPDATE sequence_key = sequence_key`,
  );
  for (const rule of segregationCatalog) {
    await execute(
      pool,
      `INSERT INTO segregation_rules (code, name, description, enabled, is_locked) VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE name = VALUES(name), description = VALUES(description), is_locked = VALUES(is_locked)`,
      [rule.code, rule.name, rule.description, rule.enabled ? 1 : 0, rule.locked ? 1 : 0],
    );
  }
  await seedApprovalWorkflows();
  await seedAuthorityLimits();
  await seedLeaveTypes();
  await seedLedger();
}

export async function seedLeaveTypes(): Promise<void> {
  const company = await queryOne<RowDataPacket>(pool, 'SELECT id FROM companies ORDER BY id LIMIT 1');
  if (!company) {
    throw new Error('Seed the company before leave types.');
  }
  const types: Array<[string, string, number, number]> = [
    ['ANNUAL', 'Annual leave', 21, 1],
    ['SICK', 'Sick leave', 10, 1],
    ['COMPASSIONATE', 'Compassionate leave', 5, 1],
    ['UNPAID', 'Unpaid leave', 0, 0],
  ];
  for (const [code, name, days, paid] of types) {
    await execute(
      pool,
      `INSERT INTO leave_types (company_id, code, name, days_per_year, paid, status)
       VALUES (?, ?, ?, ?, ?, 'active')
       ON DUPLICATE KEY UPDATE name = VALUES(name), days_per_year = VALUES(days_per_year), paid = VALUES(paid), status = 'active'`,
      [company.id, code, name, days, paid],
    );
  }
}

async function insertCatalogSteps(workflowId: number, workflow: WorkflowSeed): Promise<void> {
  let stepOrder = 1;
  for (const step of workflow.steps) {
    await execute(
      pool,
      `INSERT INTO workflow_steps (
         workflow_id, step_order, name, resolver, role_code, position_code, parallel_group,
         decision_kind, requires_expenditure_authority, is_final_business_step, min_amount, condition_flag, status
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')`,
      [
        workflowId,
        stepOrder,
        step.name,
        step.resolver,
        step.roleCode ?? null,
        step.positionCode ?? null,
        step.parallelGroup ?? null,
        step.decisionKind,
        step.requiresExpenditureAuthority ? 1 : 0,
        step.isFinalBusinessStep ? 1 : 0,
        step.minAmount ?? null,
        step.conditionFlag ?? 'always',
      ],
    );
    stepOrder += 1;
  }
}

/**
 * Creates missing routes. A stored route from the first release that nobody has edited is moved to the
 * current governance routes once (routine spending no longer goes to the CEO by default). A route an
 * administrator has changed is left as it is. Requests already submitted keep their own copy of the steps.
 */
export async function seedApprovalWorkflows(): Promise<void> {
  const company = await queryOne<RowDataPacket>(pool, 'SELECT id FROM companies ORDER BY id LIMIT 1');
  if (!company) {
    throw new Error('Seed the company before approval workflows.');
  }
  const companyId = Number(company.id);
  for (const workflow of workflowCatalog) {
    const existing = await queryOne<RowDataPacket>(
      pool,
      'SELECT id, governance_version FROM workflows WHERE company_id = ? AND code = ?',
      [companyId, workflow.code],
    );
    if (existing) {
      if (Number(existing.governance_version) >= GOVERNANCE_VERSION) continue;
      const stored = await query<RowDataPacket[]>(pool, `SELECT name FROM workflow_steps WHERE workflow_id = ? AND status = 'active' ORDER BY step_order`, [existing.id]);
      const names = stored.map((row) => String(row.name));
      const untouched = !workflow.previousStepNames || JSON.stringify(names) === JSON.stringify(workflow.previousStepNames);
      if (untouched && workflow.previousStepNames) {
        await execute(pool, 'DELETE FROM workflow_steps WHERE workflow_id = ?', [existing.id]);
        await insertCatalogSteps(Number(existing.id), workflow);
        await execute(pool, 'UPDATE workflows SET description = ? WHERE id = ?', [workflow.description, existing.id]);
        await execute(
          pool,
          `INSERT INTO audit_logs (user_id, action, module, entity_type, entity_id, previous_value, new_value)
           VALUES (NULL, 'workflow.governance_upgrade', 'approvals', 'workflow', ?, ?, ?)`,
          [String(existing.id), JSON.stringify({ steps: names }), JSON.stringify({ steps: workflow.steps.map((step) => ({ name: step.name, condition: step.conditionFlag ?? 'always' })), version: GOVERNANCE_VERSION })],
        );
        logger.info(`Workflow ${workflow.code} moved to governance version ${GOVERNANCE_VERSION}.`);
      } else if (workflow.previousStepNames) {
        logger.info(`Workflow ${workflow.code} was customised and was left unchanged.`);
      }
      await execute(pool, 'UPDATE workflows SET governance_version = ? WHERE id = ?', [GOVERNANCE_VERSION, existing.id]);
      continue;
    }
    const created = await execute(
      pool,
      `INSERT INTO workflows (company_id, code, name, description, transaction_kind, completion_role_code, requires_supporting_document, governance_version, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active')`,
      [companyId, workflow.code, workflow.name, workflow.description, workflow.transactionKind, workflow.completionRoleCode,
        workflow.requiresSupportingDocument ? 1 : 0, GOVERNANCE_VERSION],
    );
    await insertCatalogSteps(created.insertId, workflow);
  }
}

/** Opening financial limits. Existing limits, including ones an administrator changed, are kept. */
export async function seedAuthorityLimits(): Promise<void> {
  const company = await queryOne<RowDataPacket>(pool, 'SELECT id FROM companies ORDER BY id LIMIT 1');
  if (!company) return;
  for (const limit of authorityLimitCatalog) {
    const existing = await queryOne<RowDataPacket>(
      pool,
      'SELECT id FROM approval_authority_limits WHERE role_code = ? AND workflow_id IS NULL AND department_id IS NULL',
      [limit.roleCode],
    );
    if (existing) continue;
    await execute(
      pool,
      `INSERT INTO approval_authority_limits (company_id, role_code, max_amount, notes, status) VALUES (?, ?, ?, ?, 'active')`,
      [company.id, limit.roleCode, limit.maxAmount, limit.notes],
    );
  }
}

export async function seedLedger(): Promise<void> {
  const company = await queryOne<RowDataPacket>(pool, 'SELECT id FROM companies ORDER BY id LIMIT 1');
  if (!company) {
    throw new Error('Seed the company before the chart of accounts.');
  }
  const accounts: Array<[string, string, string]> = [
    ['1000', 'Cash', 'asset'],
    ['1010', 'Bank', 'asset'],
    ['1020', 'Petty cash', 'asset'],
    ['1100', 'Accounts receivable', 'asset'],
    ['2000', 'Accounts payable', 'liability'],
    ['3000', 'Equity', 'equity'],
    ['4000', 'Operating income', 'income'],
    ['5000', 'Operating expense', 'expense'],
    ['5100', 'Salaries', 'expense'],
  ];
  for (const [code, name, accountType] of accounts) {
    await execute(
      pool,
      `INSERT INTO ledger_accounts (company_id, code, name, account_type, status)
       VALUES (?, ?, ?, ?, 'active')
       ON DUPLICATE KEY UPDATE name = VALUES(name)`,
      [company.id, code, name, accountType],
    );
  }
  const books: Array<[string, string, string, string]> = [
    ['CASH', 'Cash on hand', 'cash', '1000'],
    ['BANK', 'Main bank', 'bank', '1010'],
    ['PETTY', 'Petty cash', 'petty', '1020'],
  ];
  for (const [code, name, kind, ledgerCode] of books) {
    const ledger = await queryOne<RowDataPacket>(pool, 'SELECT id FROM ledger_accounts WHERE company_id = ? AND code = ?', [company.id, ledgerCode]);
    if (!ledger) continue;
    await execute(
      pool,
      `INSERT INTO cash_accounts (company_id, code, name, kind, ledger_account_id, status)
       VALUES (?, ?, ?, ?, ?, 'active')
       ON DUPLICATE KEY UPDATE name = VALUES(name)`,
      [company.id, code, name, kind, ledger.id],
    );
  }
}

export async function seedOrganisation(): Promise<void> {
  const company = await queryOne<RowDataPacket>(pool, 'SELECT id FROM companies ORDER BY id LIMIT 1');
  if (!company) {
    throw new Error('Seed the company before the organisation.');
  }
  const companyId = Number(company.id);
  const departmentIds = new Map<string, number>();

  for (const department of initialDepartments) {
    const parentId = department.parentCode ? departmentIds.get(department.parentCode) ?? null : null;
    const existing = await queryOne<RowDataPacket>(
      pool,
      'SELECT id FROM departments WHERE company_id = ? AND code = ?',
      [companyId, department.code],
    );
    if (existing) {
      departmentIds.set(department.code, Number(existing.id));
      continue;
    }
    const result = await execute(
      pool,
      `INSERT INTO departments (company_id, parent_id, code, name, status)
       VALUES (?, ?, ?, ?, 'active')`,
      [companyId, parentId, department.code, department.name],
    );
    departmentIds.set(department.code, result.insertId);
  }

  for (const [code, workspaces] of Object.entries(departmentWorkspaces)) {
    const departmentId = departmentIds.get(code);
    if (!departmentId) {
      continue;
    }
    for (const workspace of workspaces) {
      await execute(
        pool,
        `INSERT INTO department_workspaces (department_id, workspace_code)
         VALUES (?, ?)
         ON DUPLICATE KEY UPDATE workspace_code = workspace_code`,
        [departmentId, workspace],
      );
    }
  }

  const positionIds = new Map<string, number>();
  for (const position of initialPositions) {
    const existing = await queryOne<RowDataPacket>(
      pool,
      'SELECT id FROM positions WHERE company_id = ? AND code = ?',
      [companyId, position.code],
    );
    if (existing) {
      positionIds.set(position.code, Number(existing.id));
      continue;
    }
    const departmentId = position.departmentCode ? departmentIds.get(position.departmentCode) ?? null : null;
    const result = await execute(
      pool,
      `INSERT INTO positions (company_id, department_id, code, title, is_managerial, status)
       VALUES (?, ?, ?, ?, ?, 'active')`,
      [companyId, departmentId, position.code, position.title, position.isManagerial ? 1 : 0],
    );
    positionIds.set(position.code, result.insertId);
  }

  for (const position of initialPositions) {
    if (!position.reportsToCode) {
      continue;
    }
    const positionId = positionIds.get(position.code);
    const reportsTo = positionIds.get(position.reportsToCode);
    if (!positionId || !reportsTo) {
      continue;
    }
    await execute(pool, 'UPDATE positions SET reports_to_position_id = ? WHERE id = ? AND reports_to_position_id IS NULL', [
      reportsTo,
      positionId,
    ]);
  }
}

export async function seedAdmin(): Promise<{ username: string; passwordFile: string | null }> {
  const existing = await queryOne<RowDataPacket>(pool, 'SELECT id FROM users WHERE username = ?', [env.seed.adminUsername]);
  if (existing) {
    logger.info(`Technical administrator ${env.seed.adminUsername} already exists.`);
    return { username: env.seed.adminUsername, passwordFile: null };
  }

  const role = await queryOne<RowDataPacket>(pool, 'SELECT id FROM roles WHERE code = ?', ['SYSTEM_ADMINISTRATOR']);
  if (!role) {
    throw new Error('SYSTEM_ADMINISTRATOR role is missing. Run the foundation seed first.');
  }

  const generated = env.seed.adminPassword || randomBytes(18).toString('base64url');
  const passwordHash = await hashPassword(generated);
  const result = await execute(
    pool,
    `INSERT INTO users (username, email, password_hash, status, must_change_password, password_changed_at)
     VALUES (?, ?, ?, 'active', 1, UTC_TIMESTAMP(3))`,
    [env.seed.adminUsername, env.seed.adminEmail, passwordHash],
  );
  await execute(
    pool,
    `INSERT INTO user_roles (user_id, role_id, scope_type) VALUES (?, ?, 'global')`,
    [result.insertId, role.id],
  );

  const credentialsDir = path.resolve(__dirname, '../../.credentials');
  fs.mkdirSync(credentialsDir, { recursive: true });
  const passwordFile = path.join(credentialsDir, 'sysadmin-password.txt');
  fs.writeFileSync(
    passwordFile,
    `username: ${env.seed.adminUsername}\nemail: ${env.seed.adminEmail}\ntemporary_password: ${generated}\n`,
    { encoding: 'utf8', mode: 0o600 },
  );
  logger.info(`Technical administrator created. Temporary password written to ${passwordFile}`);
  return { username: env.seed.adminUsername, passwordFile };
}

async function main(): Promise<void> {
  await seedFoundation();
  await seedOrganisation();
  await seedAdmin();
  await pool.end();
}

if (process.argv[1]?.replace(/\\/g, '/').includes('/database/seed')) {
  main().catch(async (error: unknown) => {
    logger.error('Seed failed.', error);
    await pool.end();
    process.exit(1);
  });
}
