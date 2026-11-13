import { afterAll, describe, expect, it } from 'vitest';
import { formatCedis, normalizePhone } from '../src/services/sms';
import { salaryPaidMessage } from '../src/modules/payroll/payroll.service';
import { closePool } from './helpers';

afterAll(async () => {
  await closePool();
});

describe('sms helpers', () => {
  it('turns Ghana numbers into international format and rejects junk', () => {
    expect(normalizePhone('024 412 3456')).toBe('233244123456');
    expect(normalizePhone('+233 24 412 3456')).toBe('233244123456');
    expect(normalizePhone('233244123456')).toBe('233244123456');
    expect(normalizePhone('00233244123456')).toBe('233244123456');
    expect(normalizePhone('244123456')).toBe('233244123456');
    expect(normalizePhone('+44 7700 900123')).toBe('447700900123');
    expect(normalizePhone('12345')).toBeNull();
    expect(normalizePhone('')).toBeNull();
    expect(normalizePhone(null)).toBeNull();
  });

  it('keeps the salary message inside one SMS', () => {
    expect(formatCedis(12500)).toBe('GHS 12,500.00');
    const message = salaryPaidMessage('Akosua', 'September 2026', 12500.5, 'BJG-SAL-00123', 'BAJOGO ENTERPRISE');
    expect(message).toBe('Dear Akosua, your September 2026 salary of GHS 12,500.50 has been paid. Ref: BJG-SAL-00123. BAJOGO ENTERPRISE');
    expect(message.length).toBeLessThanOrEqual(160);
  });
});
