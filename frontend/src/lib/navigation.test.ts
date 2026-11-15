import { describe, expect, it } from 'vitest';
import { visibleNavigation } from './navigation';

describe('navigation permissions', () => {
  it('hides administration from an operational role', () => {
    const items = visibleNavigation(['dashboard.view', 'departments.view', 'positions.view', 'notifications.view']);
    expect(items.map((item) => item.to)).toEqual(['/', '/company-overview', '/organisation/departments', '/organisation/positions']);
  });

  it('shows the audit log only with audit permission', () => {
    expect(visibleNavigation(['dashboard.view']).some((item) => item.to === '/admin/audit')).toBe(false);
    expect(visibleNavigation(['audit.view']).some((item) => item.to === '/admin/audit')).toBe(true);
  });

  it('shows approval governance to the CEO and the administrator but not to department staff', () => {
    expect(visibleNavigation(['governance.view'], ['*']).some((item) => item.to === '/admin/governance')).toBe(true);
    expect(visibleNavigation(['dashboard.view', 'reports.submit'], ['operations']).some((item) => item.to === '/admin/governance')).toBe(false);
    expect(visibleNavigation(['dashboard.view', 'reports.submit'], ['operations']).some((item) => item.to === '/management')).toBe(true);
  });

  it('shows approval requests to someone who can view them', () => {
    expect(visibleNavigation(['approvals.view']).some((item) => item.to === '/approvals')).toBe(true);
    expect(visibleNavigation(['approvals.view']).some((item) => item.to === '/approvals/workflows')).toBe(false);
  });

  it('shows leave self-service without HR reports', () => {
    const items = visibleNavigation(['leave.apply', 'attendance.self']);
    expect(items.some((item) => item.to === '/hr')).toBe(true);
    expect(items.some((item) => item.to === '/hr/reports')).toBe(false);
  });

  it('shows HR reports to someone who can view HR', () => {
    expect(visibleNavigation(['hr.view']).some((item) => item.to === '/hr/reports')).toBe(true);
    expect(visibleNavigation(['dashboard.view']).some((item) => item.to === '/hr')).toBe(false);
  });

  it('shows procurement and stock to the roles that hold those permissions', () => {
    expect(visibleNavigation(['procurement.view']).some((item) => item.to === '/procurement')).toBe(true);
    expect(visibleNavigation(['procurement.request']).some((item) => item.to === '/procurement')).toBe(true);
    expect(visibleNavigation(['inventory.manage']).some((item) => item.to === '/inventory')).toBe(true);
    expect(visibleNavigation(['inventory.view']).some((item) => item.to === '/inventory/reports')).toBe(true);
    expect(visibleNavigation(['finance.view']).some((item) => item.to === '/finance/reports')).toBe(true);
    expect(visibleNavigation(['finance.request']).some((item) => item.to === '/finance/payments')).toBe(true);
    expect(visibleNavigation(['dashboard.view']).some((item) => item.to.startsWith('/finance'))).toBe(false);
    expect(visibleNavigation(['dashboard.view']).some((item) => item.to.startsWith('/procurement') || item.to.startsWith('/inventory'))).toBe(false);
  });

  it('keeps a finance workspace out of HR, procurement, and inventory', () => {
    const items = visibleNavigation(
      ['dashboard.view', 'finance.view', 'finance.request', 'procurement.view', 'inventory.view', 'hr.view', 'employees.view', 'departments.view', 'leave.apply', 'approvals.view'],
      ['finance', 'people'],
    );
    const paths = items.map((item) => item.to);
    expect(paths).toContain('/');
    expect(paths).toContain('/finance');
    expect(paths).toContain('/finance/reports');
    expect(paths).toContain('/employees');
    expect(paths).toContain('/hr');
    expect(paths).toContain('/approvals');
    expect(paths.some((path) => path.startsWith('/procurement') || path.startsWith('/inventory') || path.startsWith('/organisation') || path.startsWith('/hr/'))).toBe(false);
  });

  it('shows profile settings and hides the employee directory without that permission', () => {
    const items = visibleNavigation(['dashboard.view', 'profile.view', 'finance.view'], ['finance', 'people']);
    expect(items.some((item) => item.to === '/settings')).toBe(true);
    expect(items.some((item) => item.to === '/employees')).toBe(false);
  });

  it('shows change requests once when a user can both request and implement', () => {
    const items = visibleNavigation(['organisation.request_change', 'organisation.implement_change']);
    expect(items.filter((item) => item.to === '/organisation/changes')).toHaveLength(1);
  });
});
