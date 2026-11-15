-- The CEO oversees the business through the audit log, not the account list.
-- Picking a person (delegation, corrective actions) uses /v1/directory/users instead.
DELETE FROM role_permissions
WHERE role_id IN (SELECT id FROM roles WHERE code = 'CEO')
  AND permission_id IN (SELECT id FROM permissions WHERE code = 'users.view');
