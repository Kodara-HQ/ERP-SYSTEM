import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';
import { pool } from '../src/database/pool';
import { query, queryOne, scalar } from '../src/database/query';
import { seedOrganisation } from '../src/database/seed';
import type { RowDataPacket } from '../src/database/rows';
import { ensureAllManagerEmployees } from '../src/services/managerEmployees';
import { auth, closePool, createAccount, login, resetDatabase } from './helpers';

const app = createApp();

beforeEach(async () => {
  await resetDatabase();
  await seedOrganisation();
});

afterAll(async () => {
  await closePool();
});

async function placement(username: string) {
  return queryOne<RowDataPacket>(
    pool,
    `SELECT u.employee_id, d.code AS department, p.code AS position, ea.supervisor_employee_id, b.code AS branch
     FROM users u JOIN employee_assignments ea ON ea.employee_id = u.employee_id AND ea.is_primary = 1 AND ea.end_date IS NULL
     JOIN departments d ON d.id = ea.department_id JOIN positions p ON p.id = ea.position_id JOIN branches b ON b.id = ea.branch_id
     WHERE u.username = ?`,
    [username],
  );
}

describe('managers are employees', () => {
  it('places every existing manager login in its department, CEO first, with heads reporting to the CEO', async () => {
    await createAccount('hrhead', 'HR_MANAGER');
    await createAccount('opshead', 'OPERATIONS_MANAGER');
    await createAccount('boss', 'CEO');
    await createAccount('clerk', 'PURCHASE_CLERK');
    expect(await scalar(pool, 'SELECT COUNT(*) FROM branches')).toBe(0);

    expect(await ensureAllManagerEmployees(pool)).toBe(3);
    const ceo = await placement('boss');
    expect(ceo).toMatchObject({ department: 'EXEC', position: 'CEO', branch: 'HQ', supervisor_employee_id: null });
    expect(await placement('hrhead')).toMatchObject({ department: 'HR', position: 'HR-MANAGER', supervisor_employee_id: ceo!.employee_id });
    expect(await placement('opshead')).toMatchObject({ department: 'OPS', position: 'OPS-MANAGER', supervisor_employee_id: ceo!.employee_id });
    expect(await placement('clerk')).toBeNull();
    const lines = await query<RowDataPacket[]>(pool, 'SELECT reports_to_employee_id FROM reporting_relationships');
    expect(lines.map((row) => Number(row.reports_to_employee_id))).toEqual([Number(ceo!.employee_id), Number(ceo!.employee_id)]);
    // A head office was made because the company had no branch, and running again changes nothing.
    expect(await scalar(pool, 'SELECT COUNT(*) FROM branches')).toBe(1);
    expect(await ensureAllManagerEmployees(pool)).toBe(0);
    expect(await scalar(pool, 'SELECT COUNT(*) FROM employees')).toBe(3);

    // The linked HR Manager works as an HR employee.
    const hr = await login(app, 'hrhead');
    const me = await request(app).get('/api/v1/auth/me').set(auth(hr));
    expect(me.body.data.workspaces).toEqual(expect.arrayContaining(['hr', 'people']));
    const staff = await request(app).get('/api/v1/employees').set(auth(hr));
    expect(staff.status).toBe(200);
    expect(staff.body.data).toHaveLength(3);
  });

  it('makes a new manager account an employee as soon as the role is given', async () => {
    await createAccount('sysadmin', 'SYSTEM_ADMINISTRATOR');
    const token = await login(app, 'sysadmin');
    const roles = await request(app).get('/api/v1/roles').set(auth(token));
    const roleId = (code: string) => roles.body.data.find((role: { code: string }) => role.code === code).id as number;

    const created = await request(app).post('/api/v1/users').set(auth(token)).send({
      username: 'legal.head', email: 'legal.head@bajogo.test', password: 'Temporary12345',
      role: { roleId: roleId('LEGAL_AFFAIRS'), scopeType: 'global', reason: 'Appointed Legal Affairs head.' },
    });
    expect(created.status).toBe(201);
    expect(await placement('legal.head')).toMatchObject({ department: 'LEG', position: 'LEGAL-OFFICER' });
    const employee = await queryOne<RowDataPacket>(pool, `SELECT first_name, last_name, work_email FROM employees e JOIN users u ON u.employee_id = e.id WHERE u.username = 'legal.head'`);
    expect(employee).toMatchObject({ first_name: 'Legal', last_name: 'Head', work_email: 'legal.head@bajogo.test' });

    // An account that is given a management role later is placed then.
    const plain = await request(app).post('/api/v1/users').set(auth(token)).send({ username: 'itlead', email: 'itlead@bajogo.test', password: 'Temporary12345' });
    expect(await placement('itlead')).toBeNull();
    const assigned = await request(app).post(`/api/v1/users/${plain.body.data.id}/roles`).set(auth(token))
      .send({ roleId: roleId('IT_MARKETING_MANAGER'), scopeType: 'global', reason: 'Appointed IT & Marketing head.' });
    expect(assigned.status).toBeLessThan(300);
    expect(await placement('itlead')).toMatchObject({ department: 'ITM', position: 'IT-MARKETING-MANAGER' });
    expect(await scalar(pool, `SELECT COUNT(*) FROM audit_logs WHERE action = 'employee.create_for_manager'`)).toBe(2);
  });
});
