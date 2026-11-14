import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';
import { auth, closePool, createAccount, login, resetDatabase } from './helpers';

const app = createApp();

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await closePool();
});

async function adminSession() {
  await createAccount('sysadmin', 'SYSTEM_ADMINISTRATOR');
  const token = await login(app, 'sysadmin');
  const roles = await request(app).get('/api/v1/roles').set(auth(token));
  const roleId = (code: string) => roles.body.data.find((role: { code: string }) => role.code === code).id as number;
  return { token, roleId };
}

describe('creating an account with its role', () => {
  it('creates the login and assigns a protected role in one step', async () => {
    const { token, roleId } = await adminSession();
    const created = await request(app).post('/api/v1/users').set(auth(token)).send({
      username: 'HR.Manager',
      email: 'hr.manager@bajogo.test',
      password: 'Temporary12345',
      role: { roleId: roleId('HR_MANAGER'), scopeType: 'global', reason: 'Appointed HR Manager by the CEO.' },
    });
    expect(created.status).toBe(201);
    expect(created.body.data.username).toBe('hr.manager');
    expect(created.body.data.roles).toEqual([expect.objectContaining({ code: 'HR_MANAGER', scopeType: 'global' })]);

    const list = await request(app).get('/api/v1/users').set(auth(token));
    const row = list.body.data.find((user: { username: string }) => user.username === 'hr.manager');
    expect(row.roles.map((role: { code: string }) => role.code)).toEqual(['HR_MANAGER']);
  });

  it('creates nothing when the protected role has no reason', async () => {
    const { token, roleId } = await adminSession();
    const created = await request(app).post('/api/v1/users').set(auth(token)).send({
      username: 'hrm',
      email: 'hrm@bajogo.test',
      password: 'Temporary12345',
      role: { roleId: roleId('HR_MANAGER'), scopeType: 'global' },
    });
    expect(created.status).toBe(422);

    const list = await request(app).get('/api/v1/users?search=hrm').set(auth(token));
    expect(list.body.data).toHaveLength(0);
  });

  it('still creates an account without a role', async () => {
    const { token } = await adminSession();
    const created = await request(app).post('/api/v1/users').set(auth(token)).send({
      username: 'newstarter',
      email: 'newstarter@bajogo.test',
      password: 'Temporary12345',
    });
    expect(created.status).toBe(201);
    expect(created.body.data.roles).toEqual([]);
  });
});
