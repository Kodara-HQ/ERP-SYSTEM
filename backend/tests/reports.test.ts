import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';
import { longDate, periodLabel } from '../src/modules/reports/reports.service';
import { auth, closePool, createAccount, login, resetDatabase } from './helpers';

const app = createApp();

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await closePool();
});

describe('CEO reports', () => {
  it('writes periods as 10th November 2026 - 5th December 2026', () => {
    expect(periodLabel({ from: '2026-11-10', to: '2026-12-05' })).toBe('10th November 2026 - 5th December 2026');
    expect(['2026-01-01', '2026-01-02', '2026-01-03', '2026-01-11', '2026-01-12', '2026-01-13', '2026-01-21', '2026-01-22', '2026-01-23', '2026-01-31'].map(longDate)).toEqual([
      '1st January 2026', '2nd January 2026', '3rd January 2026', '11th January 2026', '12th January 2026',
      '13th January 2026', '21st January 2026', '22nd January 2026', '23rd January 2026', '31st January 2026',
    ]);
  });

  it('builds every report the CEO can choose for a date range', async () => {
    await createAccount('sysadmin', 'SYSTEM_ADMINISTRATOR');
    await createAccount('ceo', 'CEO');
    const admin = await login(app, 'sysadmin');
    const ceo = await login(app, 'ceo');
    await request(app).post('/api/v1/organisation/departments').set(auth(admin)).send({ code: 'QA', name: 'Quality' });

    const catalog = await request(app).get('/api/v1/reports').set(auth(ceo));
    expect(catalog.status).toBe(200);
    const codes = catalog.body.data.map((row: { code: string }) => row.code);
    expect(codes).toEqual(expect.arrayContaining(['overview', 'finance', 'approvals', 'hr', 'payroll', 'procurement', 'inventory', 'operations', 'executive', 'administration']));

    const today = new Date().toISOString().slice(0, 10);
    for (const code of codes) {
      const report = await request(app).get(`/api/v1/reports/${code}?from=2026-01-01&to=${today}`).set(auth(ceo));
      expect(report.status, `${code}: ${JSON.stringify(report.body)}`).toBe(200);
      expect(report.body.data.period).toBe(periodLabel({ from: '2026-01-01', to: today }));
      expect(report.body.data.tables.length).toBeGreaterThan(0);
    }

    const activity = await request(app).get(`/api/v1/reports/administration?from=2026-01-01&to=${today}`).set(auth(ceo));
    const adminRows = activity.body.data.tables.find((table: { title: string }) => table.title === 'System administrator actions').rows;
    expect(adminRows.some((row: string[]) => row[1] === 'sysadmin')).toBe(true);
  });

  it('downloads a report as Excel, PDF and CSV', async () => {
    await createAccount('ceo', 'CEO');
    const ceo = await login(app, 'ceo');
    const query = '?from=2026-11-10&to=2026-12-05';
    const xlsx = await request(app).get(`/api/v1/reports/overview.xlsx${query}`).set(auth(ceo));
    expect(xlsx.status).toBe(200);
    expect(xlsx.headers['content-type']).toContain('spreadsheetml');
    const pdf = await request(app).get(`/api/v1/reports/overview.pdf${query}`).set(auth(ceo));
    expect(pdf.status).toBe(200);
    expect(pdf.headers['content-type']).toContain('pdf');
    const csv = await request(app).get(`/api/v1/reports/overview.csv${query}`).set(auth(ceo));
    expect(csv.status).toBe(200);
    expect(csv.text).toContain('Company overview: 10th November 2026 - 5th December 2026');
  });

  it('refuses a backwards range and anyone who is not the CEO', async () => {
    await createAccount('ceo', 'CEO');
    await createAccount('hrm', 'HR_MANAGER');
    const ceo = await login(app, 'ceo');
    const hrm = await login(app, 'hrm');
    expect((await request(app).get('/api/v1/reports/overview?from=2026-12-05&to=2026-11-10').set(auth(ceo))).status).toBe(422);
    expect((await request(app).get('/api/v1/reports').set(auth(hrm))).status).toBe(403);
  });
});
