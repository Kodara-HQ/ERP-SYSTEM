-- The CEO's final financial approval applies to every amount.
UPDATE workflow_steps s
JOIN workflows w ON w.id = s.workflow_id
SET s.min_amount = NULL
WHERE s.is_final_business_step = 1
  AND s.requires_expenditure_authority = 1
  AND s.min_amount IS NOT NULL;

UPDATE workflows
SET description = 'Driver, fleet supervisor, operations, accounts verification, then the CEO''s final financial approval.'
WHERE code IN ('FUEL', 'VEHICLE_REPAIR');
