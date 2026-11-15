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

describe('CEO oversight', () => {
  it('keeps the CEO out of user accounts but shows the system administrator\'s actions in the audit log', async () => {
    await createAccount('sysadmin', 'SYSTEM_ADMINISTRATOR');
    await createAccount('ceo', 'CEO');
    const admin = await login(app, 'sysadmin');
    const ceo = await login(app, 'ceo');

    const created = await request(app).post('/api/v1/users').set(auth(admin)).send({
      username: 'newstarter',
      email: 'newstarter@bajogo.test',
      password: 'Temporary12345',
    });
    expect(created.status).toBe(201);

    expect((await request(app).get('/api/v1/users').set(auth(ceo))).status).toBe(403);

    const ceoAudit = await request(app).get('/api/v1/audit?search=sysadmin').set(auth(ceo));
    expect(ceoAudit.status).toBe(200);
    expect(ceoAudit.body.data.some((row: { action: string }) => row.action === 'user.create')).toBe(true);

    const adminAudit = await request(app).get('/api/v1/audit?search=sysadmin').set(auth(admin));
    expect(adminAudit.status).toBe(200);
    expect(adminAudit.body.data.some((row: { action: string }) => row.action === 'user.create')).toBe(true);
  });

  it('still lets the CEO pick a person to delegate approvals to', async () => {
    await createAccount('ceo', 'CEO');
    await createAccount('deputy', 'OPERATIONS_MANAGER');
    const ceo = await login(app, 'ceo');

    const people = await request(app).get('/api/v1/directory/users').set(auth(ceo));
    expect(people.status).toBe(200);
    expect(people.body.data.map((row: { username: string }) => row.username)).toContain('deputy');
    expect(people.body.data[0]).not.toHaveProperty('email');
  });
});
