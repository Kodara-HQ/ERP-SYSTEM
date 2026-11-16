-- Every head of department prepares their department's budget and payment requests, and every manager
-- keeps the full employee set. Adds only what each role is missing; nothing is removed.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r, permissions p
WHERE (
    (r.code IN ('HR_MANAGER', 'OPERATIONS_MANAGER', 'ACCOUNTS_OFFICER', 'LEGAL_AFFAIRS', 'IT_MARKETING_MANAGER')
      AND p.code IN (
        'dashboard.view', 'profile.view', 'notifications.view', 'legal.request',
        'departments.view', 'positions.view', 'branches.view', 'locations.view',
        'organisation.request_change',
        'approvals.view', 'approvals.submit', 'approvals.decide', 'approvals.delegate', 'approvals.process',
        'leave.apply', 'attendance.self', 'reports.submit', 'support.request',
        'reports.review', 'targets.manage', 'assessments.manage', 'finance.request'
      ))
    OR (r.code = 'HR_OFFICER'
      AND p.code IN (
        'dashboard.view', 'profile.view', 'notifications.view', 'legal.request',
        'departments.view', 'positions.view', 'branches.view', 'locations.view',
        'approvals.view', 'approvals.submit', 'approvals.decide',
        'leave.apply', 'attendance.self', 'reports.submit', 'support.request'
      ))
  )
  AND NOT EXISTS (
    SELECT 1 FROM role_permissions rp WHERE rp.role_id = r.id AND rp.permission_id = p.id
  );
