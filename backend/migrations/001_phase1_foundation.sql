-- BAJOGO ERP Phase 1 foundation.
-- MySQL 8.0+, InnoDB, utf8mb4. The migration runner selects the database first.

CREATE TABLE companies (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  legal_name VARCHAR(200) NOT NULL,
  trading_name VARCHAR(200) NULL,
  registration_number VARCHAR(80) NULL,
  tax_identification_number VARCHAR(80) NULL,
  email VARCHAR(180) NULL,
  phone VARCHAR(40) NULL,
  website VARCHAR(255) NULL,
  address_line VARCHAR(255) NULL,
  city VARCHAR(120) NULL,
  country VARCHAR(120) NULL,
  currency_code CHAR(3) NOT NULL DEFAULT 'USD',
  timezone VARCHAR(64) NOT NULL DEFAULT 'UTC',
  fiscal_year_start_month TINYINT UNSIGNED NOT NULL DEFAULT 1,
  status ENUM('active', 'inactive') NOT NULL DEFAULT 'active',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  CONSTRAINT chk_companies_fiscal_month CHECK (fiscal_year_start_month BETWEEN 1 AND 12)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE branches (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  company_id BIGINT UNSIGNED NOT NULL,
  code VARCHAR(30) NOT NULL,
  name VARCHAR(160) NOT NULL,
  phone VARCHAR(40) NULL,
  email VARCHAR(180) NULL,
  address_line VARCHAR(255) NULL,
  city VARCHAR(120) NULL,
  is_head_office TINYINT(1) NOT NULL DEFAULT 0,
  status ENUM('active', 'inactive') NOT NULL DEFAULT 'active',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  deleted_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_branches_company_code (company_id, code),
  KEY idx_branches_status (company_id, status),
  CONSTRAINT fk_branches_company FOREIGN KEY (company_id) REFERENCES companies (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE locations (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  company_id BIGINT UNSIGNED NOT NULL,
  branch_id BIGINT UNSIGNED NOT NULL,
  code VARCHAR(30) NOT NULL,
  name VARCHAR(160) NOT NULL,
  location_type ENUM('office', 'warehouse', 'farm', 'yard', 'workshop', 'other') NOT NULL DEFAULT 'office',
  address_line VARCHAR(255) NULL,
  city VARCHAR(120) NULL,
  status ENUM('active', 'inactive') NOT NULL DEFAULT 'active',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  deleted_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_locations_company_code (company_id, code),
  KEY idx_locations_branch (branch_id, status),
  CONSTRAINT fk_locations_company FOREIGN KEY (company_id) REFERENCES companies (id),
  CONSTRAINT fk_locations_branch FOREIGN KEY (branch_id) REFERENCES branches (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE departments (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  company_id BIGINT UNSIGNED NOT NULL,
  branch_id BIGINT UNSIGNED NULL,
  parent_id BIGINT UNSIGNED NULL,
  code VARCHAR(40) NOT NULL,
  name VARCHAR(160) NOT NULL,
  description VARCHAR(500) NULL,
  status ENUM('active', 'inactive') NOT NULL DEFAULT 'active',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  deleted_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_departments_company_code (company_id, code),
  KEY idx_departments_parent (parent_id),
  KEY idx_departments_branch (branch_id),
  CONSTRAINT fk_departments_company FOREIGN KEY (company_id) REFERENCES companies (id),
  CONSTRAINT fk_departments_branch FOREIGN KEY (branch_id) REFERENCES branches (id),
  CONSTRAINT fk_departments_parent FOREIGN KEY (parent_id) REFERENCES departments (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE positions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  company_id BIGINT UNSIGNED NOT NULL,
  department_id BIGINT UNSIGNED NULL,
  code VARCHAR(40) NOT NULL,
  title VARCHAR(160) NOT NULL,
  description VARCHAR(500) NULL,
  grade VARCHAR(40) NULL,
  is_managerial TINYINT(1) NOT NULL DEFAULT 0,
  reports_to_position_id BIGINT UNSIGNED NULL,
  status ENUM('active', 'inactive') NOT NULL DEFAULT 'active',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  deleted_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_positions_company_code (company_id, code),
  KEY idx_positions_department (department_id, status),
  CONSTRAINT fk_positions_company FOREIGN KEY (company_id) REFERENCES companies (id),
  CONSTRAINT fk_positions_department FOREIGN KEY (department_id) REFERENCES departments (id),
  CONSTRAINT fk_positions_reports_to FOREIGN KEY (reports_to_position_id) REFERENCES positions (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE employees (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  company_id BIGINT UNSIGNED NOT NULL,
  employee_number VARCHAR(30) NOT NULL,
  first_name VARCHAR(80) NOT NULL,
  last_name VARCHAR(80) NOT NULL,
  other_names VARCHAR(120) NULL,
  work_email VARCHAR(180) NULL,
  personal_email VARCHAR(180) NULL,
  phone VARCHAR(40) NULL,
  date_of_birth DATE NULL,
  gender ENUM('female', 'male', 'other', 'undisclosed') NULL,
  national_id VARCHAR(80) NULL,
  hire_date DATE NULL,
  employment_status ENUM('active', 'probation', 'suspended', 'exited') NOT NULL DEFAULT 'active',
  confidentiality_level ENUM('standard', 'confidential', 'restricted') NOT NULL DEFAULT 'standard',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  deleted_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_employees_number (employee_number),
  UNIQUE KEY uq_employees_work_email (company_id, work_email),
  KEY idx_employees_name (last_name, first_name),
  KEY idx_employees_status (company_id, employment_status),
  CONSTRAINT fk_employees_company FOREIGN KEY (company_id) REFERENCES companies (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE users (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  employee_id BIGINT UNSIGNED NULL,
  username VARCHAR(60) NOT NULL,
  email VARCHAR(180) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  status ENUM('active', 'locked', 'disabled') NOT NULL DEFAULT 'active',
  failed_login_attempts INT UNSIGNED NOT NULL DEFAULT 0,
  locked_until DATETIME(3) NULL,
  last_login_at DATETIME(3) NULL,
  password_changed_at DATETIME(3) NULL,
  must_change_password TINYINT(1) NOT NULL DEFAULT 1,
  token_version INT UNSIGNED NOT NULL DEFAULT 0,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_username (username),
  UNIQUE KEY uq_users_email (email),
  UNIQUE KEY uq_users_employee (employee_id),
  CONSTRAINT fk_users_employee FOREIGN KEY (employee_id) REFERENCES employees (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE employment_records (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  employee_id BIGINT UNSIGNED NOT NULL,
  employment_type ENUM('permanent', 'fixed_term', 'temporary', 'casual', 'intern') NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NULL,
  status ENUM('active', 'ended') NOT NULL DEFAULT 'active',
  notes VARCHAR(500) NULL,
  created_by BIGINT UNSIGNED NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_employment_employee (employee_id, status),
  CONSTRAINT fk_employment_employee FOREIGN KEY (employee_id) REFERENCES employees (id),
  CONSTRAINT fk_employment_created_by FOREIGN KEY (created_by) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE employee_assignments (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  employee_id BIGINT UNSIGNED NOT NULL,
  department_id BIGINT UNSIGNED NOT NULL,
  position_id BIGINT UNSIGNED NOT NULL,
  branch_id BIGINT UNSIGNED NOT NULL,
  location_id BIGINT UNSIGNED NULL,
  supervisor_employee_id BIGINT UNSIGNED NULL,
  assignment_type ENUM('substantive', 'acting', 'temporary') NOT NULL DEFAULT 'substantive',
  is_primary TINYINT(1) NOT NULL DEFAULT 0,
  start_date DATE NOT NULL,
  end_date DATE NULL,
  reason VARCHAR(300) NULL,
  created_by BIGINT UNSIGNED NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_assignments_current (employee_id, end_date, is_primary),
  KEY idx_assignments_department (department_id, end_date),
  KEY idx_assignments_branch (branch_id, end_date),
  KEY idx_assignments_position (position_id),
  CONSTRAINT fk_assignments_employee FOREIGN KEY (employee_id) REFERENCES employees (id),
  CONSTRAINT fk_assignments_department FOREIGN KEY (department_id) REFERENCES departments (id),
  CONSTRAINT fk_assignments_position FOREIGN KEY (position_id) REFERENCES positions (id),
  CONSTRAINT fk_assignments_branch FOREIGN KEY (branch_id) REFERENCES branches (id),
  CONSTRAINT fk_assignments_location FOREIGN KEY (location_id) REFERENCES locations (id),
  CONSTRAINT fk_assignments_supervisor FOREIGN KEY (supervisor_employee_id) REFERENCES employees (id),
  CONSTRAINT fk_assignments_created_by FOREIGN KEY (created_by) REFERENCES users (id),
  CONSTRAINT chk_assignments_not_own_supervisor CHECK (supervisor_employee_id IS NULL OR supervisor_employee_id <> employee_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE reporting_relationships (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  employee_id BIGINT UNSIGNED NOT NULL,
  reports_to_employee_id BIGINT UNSIGNED NOT NULL,
  relationship_type ENUM('line', 'functional', 'dotted', 'acting') NOT NULL DEFAULT 'line',
  is_primary TINYINT(1) NOT NULL DEFAULT 0,
  start_date DATE NOT NULL,
  end_date DATE NULL,
  notes VARCHAR(300) NULL,
  created_by BIGINT UNSIGNED NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_reporting_employee (employee_id, end_date),
  KEY idx_reporting_manager (reports_to_employee_id, end_date),
  CONSTRAINT fk_reporting_employee FOREIGN KEY (employee_id) REFERENCES employees (id),
  CONSTRAINT fk_reporting_manager FOREIGN KEY (reports_to_employee_id) REFERENCES employees (id),
  CONSTRAINT fk_reporting_created_by FOREIGN KEY (created_by) REFERENCES users (id),
  CONSTRAINT chk_reporting_not_self CHECK (employee_id <> reports_to_employee_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE roles (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  code VARCHAR(60) NOT NULL,
  name VARCHAR(120) NOT NULL,
  description VARCHAR(400) NULL,
  is_system TINYINT(1) NOT NULL DEFAULT 0,
  is_technical_admin TINYINT(1) NOT NULL DEFAULT 0,
  can_approve_expenditure TINYINT(1) NOT NULL DEFAULT 0,
  has_final_business_authority TINYINT(1) NOT NULL DEFAULT 0,
  status ENUM('active', 'inactive') NOT NULL DEFAULT 'active',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_roles_code (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE permissions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  code VARCHAR(80) NOT NULL,
  module VARCHAR(40) NOT NULL,
  action VARCHAR(40) NOT NULL,
  description VARCHAR(255) NOT NULL,
  sensitivity ENUM('standard', 'technical', 'confidential', 'expenditure') NOT NULL DEFAULT 'standard',
  PRIMARY KEY (id),
  UNIQUE KEY uq_permissions_code (code),
  KEY idx_permissions_module (module)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE role_permissions (
  role_id BIGINT UNSIGNED NOT NULL,
  permission_id BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (role_id, permission_id),
  CONSTRAINT fk_role_permissions_role FOREIGN KEY (role_id) REFERENCES roles (id) ON DELETE CASCADE,
  CONSTRAINT fk_role_permissions_permission FOREIGN KEY (permission_id) REFERENCES permissions (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE user_roles (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id BIGINT UNSIGNED NOT NULL,
  role_id BIGINT UNSIGNED NOT NULL,
  scope_type ENUM('global', 'branch', 'department', 'own') NOT NULL DEFAULT 'global',
  scope_id BIGINT UNSIGNED NULL,
  assigned_by BIGINT UNSIGNED NULL,
  starts_on DATE NULL,
  ends_on DATE NULL,
  scope_key VARCHAR(40) GENERATED ALWAYS AS (CONCAT(scope_type, ':', IFNULL(scope_id, 0))) STORED,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_user_role_scope (user_id, role_id, scope_key),
  KEY idx_user_roles_role (role_id),
  CONSTRAINT fk_user_roles_user FOREIGN KEY (user_id) REFERENCES users (id),
  CONSTRAINT fk_user_roles_role FOREIGN KEY (role_id) REFERENCES roles (id),
  CONSTRAINT fk_user_roles_assigned_by FOREIGN KEY (assigned_by) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE user_sessions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id BIGINT UNSIGNED NOT NULL,
  refresh_token_hash CHAR(64) NOT NULL,
  ip_address VARCHAR(45) NULL,
  user_agent VARCHAR(255) NULL,
  expires_at DATETIME(3) NOT NULL,
  revoked_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_sessions_refresh (refresh_token_hash),
  KEY idx_sessions_user (user_id, expires_at),
  CONSTRAINT fk_sessions_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE login_attempts (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  username VARCHAR(60) NOT NULL,
  success TINYINT(1) NOT NULL,
  ip_address VARCHAR(45) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_login_attempts_user_time (username, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE organisational_change_requests (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  reference_number VARCHAR(30) NOT NULL,
  change_type VARCHAR(60) NOT NULL,
  payload JSON NOT NULL,
  reason VARCHAR(1000) NOT NULL,
  status ENUM('submitted', 'implemented', 'rejected', 'cancelled') NOT NULL DEFAULT 'submitted',
  requested_by_user_id BIGINT UNSIGNED NOT NULL,
  reviewed_by_user_id BIGINT UNSIGNED NULL,
  review_comment VARCHAR(1000) NULL,
  implemented_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_org_change_reference (reference_number),
  KEY idx_org_change_status (status, created_at),
  CONSTRAINT fk_org_change_requester FOREIGN KEY (requested_by_user_id) REFERENCES users (id),
  CONSTRAINT fk_org_change_reviewer FOREIGN KEY (reviewed_by_user_id) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE notifications (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id BIGINT UNSIGNED NOT NULL,
  title VARCHAR(180) NOT NULL,
  body VARCHAR(500) NOT NULL,
  notification_type VARCHAR(60) NOT NULL,
  entity_type VARCHAR(60) NULL,
  entity_id VARCHAR(40) NULL,
  is_read TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  read_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  KEY idx_notifications_user (user_id, is_read, created_at),
  CONSTRAINT fk_notifications_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE audit_logs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id BIGINT UNSIGNED NULL,
  action VARCHAR(80) NOT NULL,
  module VARCHAR(40) NOT NULL,
  entity_type VARCHAR(60) NOT NULL,
  entity_id VARCHAR(40) NULL,
  previous_value JSON NULL,
  new_value JSON NULL,
  ip_address VARCHAR(45) NULL,
  user_agent VARCHAR(255) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_audit_entity (entity_type, entity_id),
  KEY idx_audit_user_time (user_id, created_at),
  KEY idx_audit_module_time (module, created_at),
  CONSTRAINT fk_audit_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE system_settings (
  setting_key VARCHAR(80) NOT NULL,
  setting_value JSON NOT NULL,
  updated_by BIGINT UNSIGNED NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (setting_key),
  CONSTRAINT fk_settings_user FOREIGN KEY (updated_by) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE reference_sequences (
  sequence_key VARCHAR(50) NOT NULL,
  next_value INT UNSIGNED NOT NULL,
  PRIMARY KEY (sequence_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
