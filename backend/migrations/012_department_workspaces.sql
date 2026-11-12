-- A department's workspace is configuration, read at request time.
-- The application does not decide access from a department name.

CREATE TABLE department_workspaces (
  department_id BIGINT UNSIGNED NOT NULL,
  workspace_code VARCHAR(40) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (department_id, workspace_code),
  CONSTRAINT fk_department_workspaces_department FOREIGN KEY (department_id) REFERENCES departments (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO department_workspaces (department_id, workspace_code)
SELECT d.id, w.workspace_code
FROM departments d
JOIN (
  SELECT 'HR' AS code, 'hr' AS workspace_code UNION ALL
  SELECT 'HR', 'people' UNION ALL
  SELECT 'OPS', 'procurement' UNION ALL
  SELECT 'OPS', 'inventory' UNION ALL
  SELECT 'OPS', 'people' UNION ALL
  SELECT 'OPS-PROC', 'procurement' UNION ALL
  SELECT 'OPS-PROC', 'people' UNION ALL
  SELECT 'OPS-LOAD', 'people' UNION ALL
  SELECT 'OPS-HAUL', 'people' UNION ALL
  SELECT 'OPS-STORES', 'inventory' UNION ALL
  SELECT 'OPS-STORES', 'people' UNION ALL
  SELECT 'FIN', 'finance' UNION ALL
  SELECT 'FIN', 'people' UNION ALL
  SELECT 'LEG', 'legal' UNION ALL
  SELECT 'LEG', 'people' UNION ALL
  SELECT 'ITM', 'people' UNION ALL
  SELECT 'ITM-IT', 'people' UNION ALL
  SELECT 'ITM-MKT', 'people'
) w ON w.code = d.code;
