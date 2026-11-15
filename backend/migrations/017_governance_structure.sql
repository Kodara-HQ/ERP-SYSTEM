-- Management structure, configurable approval authority, separation of duties,
-- supporting documents, departmental reporting, and the department registers.
-- Existing records are kept. New columns default to the previous behaviour.

ALTER TABLE workflows
  ADD COLUMN requires_supporting_document SMALLINT NOT NULL DEFAULT 0,
  ADD COLUMN governance_version INT NOT NULL DEFAULT 1;

ALTER TABLE workflow_steps
  ADD COLUMN applies_to_position_code VARCHAR(40) NULL,
  ADD COLUMN condition_flag VARCHAR(20) NOT NULL DEFAULT 'always',
  ADD COLUMN escalate_after_hours INT NULL,
  ADD COLUMN escalation_role_code VARCHAR(60) NULL;

ALTER TABLE approval_requests
  ADD COLUMN special_approval SMALLINT NOT NULL DEFAULT 0;

ALTER TABLE approval_request_steps
  ADD COLUMN escalate_after_hours INT NULL,
  ADD COLUMN escalation_role_code VARCHAR(60) NULL,
  ADD COLUMN activated_at TIMESTAMP NULL,
  ADD COLUMN escalated_at TIMESTAMP NULL,
  ADD COLUMN added_reason VARCHAR(300) NULL;

UPDATE approval_request_steps SET activated_at = CURRENT_TIMESTAMP WHERE status = 'pending';

ALTER TABLE approval_actions
  ALTER COLUMN actor_user_id DROP NOT NULL,
  DROP CONSTRAINT approval_actions_action_check,
  ADD CONSTRAINT approval_actions_action_check CHECK (action IN ('submit', 'approve', 'reject', 'return', 'resubmit', 'cancel', 'remind', 'process', 'complete', 'escalate', 'attach'));

ALTER TABLE legal_documents
  DROP CONSTRAINT legal_documents_document_type_check,
  ADD CONSTRAINT legal_documents_document_type_check CHECK (document_type IN ('contract', 'mou', 'agreement', 'supplier_agreement', 'customer_agreement', 'land_document', 'lease'));

CREATE TABLE approval_authority_limits (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  company_id BIGINT UNSIGNED NOT NULL,
  role_code VARCHAR(60) NOT NULL,
  workflow_id BIGINT UNSIGNED NULL,
  department_id BIGINT UNSIGNED NULL,
  max_amount DECIMAL(18, 2) NULL,
  notes VARCHAR(500) NULL,
  status ENUM('active', 'inactive') NOT NULL DEFAULT 'active',
  created_by BIGINT UNSIGNED NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_authority_limits_role (role_code, status),
  CONSTRAINT fk_authority_limits_company FOREIGN KEY (company_id) REFERENCES companies (id),
  CONSTRAINT fk_authority_limits_workflow FOREIGN KEY (workflow_id) REFERENCES workflows (id),
  CONSTRAINT fk_authority_limits_department FOREIGN KEY (department_id) REFERENCES departments (id),
  CONSTRAINT fk_authority_limits_user FOREIGN KEY (created_by) REFERENCES users (id),
  CONSTRAINT chk_authority_limit_amount CHECK (max_amount IS NULL OR max_amount >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE segregation_rules (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  code VARCHAR(60) NOT NULL,
  name VARCHAR(160) NOT NULL,
  description VARCHAR(500) NOT NULL,
  enabled TINYINT(1) NOT NULL DEFAULT 1,
  is_locked TINYINT(1) NOT NULL DEFAULT 0,
  updated_by BIGINT UNSIGNED NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_segregation_rules_code (code),
  CONSTRAINT fk_segregation_rules_user FOREIGN KEY (updated_by) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE supporting_documents (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  company_id BIGINT UNSIGNED NOT NULL,
  entity_type VARCHAR(60) NOT NULL,
  entity_id BIGINT UNSIGNED NOT NULL,
  file_name VARCHAR(200) NOT NULL,
  content_type VARCHAR(120) NOT NULL,
  size_bytes INT UNSIGNED NOT NULL,
  sha256 CHAR(64) NOT NULL,
  content BYTEA NOT NULL,
  description VARCHAR(300) NULL,
  uploaded_by BIGINT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_supporting_documents_entity (entity_type, entity_id),
  CONSTRAINT fk_supporting_documents_company FOREIGN KEY (company_id) REFERENCES companies (id),
  CONSTRAINT fk_supporting_documents_user FOREIGN KEY (uploaded_by) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE announcements (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  company_id BIGINT UNSIGNED NOT NULL,
  title VARCHAR(200) NOT NULL,
  body VARCHAR(4000) NOT NULL,
  status ENUM('published', 'withdrawn') NOT NULL DEFAULT 'published',
  expires_on DATE NULL,
  published_by BIGINT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_announcements_status (status, created_at),
  CONSTRAINT fk_announcements_company FOREIGN KEY (company_id) REFERENCES companies (id),
  CONSTRAINT fk_announcements_user FOREIGN KEY (published_by) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE department_reports (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  company_id BIGINT UNSIGNED NOT NULL,
  reference_number VARCHAR(40) NOT NULL,
  department_id BIGINT UNSIGNED NOT NULL,
  period_type ENUM('daily', 'weekly', 'monthly', 'quarterly', 'annual') NOT NULL,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  title VARCHAR(200) NOT NULL,
  summary VARCHAR(4000) NOT NULL,
  achievements VARCHAR(4000) NULL,
  challenges VARCHAR(4000) NULL,
  next_steps VARCHAR(4000) NULL,
  audience ENUM('manager', 'ceo') NOT NULL,
  status ENUM('draft', 'submitted', 'reviewed', 'returned') NOT NULL DEFAULT 'draft',
  author_user_id BIGINT UNSIGNED NOT NULL,
  submitted_at DATETIME(3) NULL,
  reviewer_user_id BIGINT UNSIGNED NULL,
  reviewed_at DATETIME(3) NULL,
  review_comment VARCHAR(1000) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_department_reports_reference (reference_number),
  KEY idx_department_reports_department (department_id, period_type, period_start),
  CONSTRAINT fk_department_reports_company FOREIGN KEY (company_id) REFERENCES companies (id),
  CONSTRAINT fk_department_reports_department FOREIGN KEY (department_id) REFERENCES departments (id),
  CONSTRAINT fk_department_reports_author FOREIGN KEY (author_user_id) REFERENCES users (id),
  CONSTRAINT fk_department_reports_reviewer FOREIGN KEY (reviewer_user_id) REFERENCES users (id),
  CONSTRAINT chk_department_reports_period CHECK (period_end >= period_start)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE department_targets (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  company_id BIGINT UNSIGNED NOT NULL,
  department_id BIGINT UNSIGNED NOT NULL,
  title VARCHAR(200) NOT NULL,
  metric VARCHAR(120) NOT NULL,
  unit VARCHAR(40) NOT NULL,
  target_value DECIMAL(18, 2) NOT NULL,
  actual_value DECIMAL(18, 2) NOT NULL DEFAULT 0,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  status ENUM('active', 'achieved', 'missed', 'cancelled') NOT NULL DEFAULT 'active',
  created_by BIGINT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_department_targets_department (department_id, status),
  CONSTRAINT fk_department_targets_company FOREIGN KEY (company_id) REFERENCES companies (id),
  CONSTRAINT fk_department_targets_department FOREIGN KEY (department_id) REFERENCES departments (id),
  CONSTRAINT fk_department_targets_user FOREIGN KEY (created_by) REFERENCES users (id),
  CONSTRAINT chk_department_targets_period CHECK (period_end >= period_start)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE performance_assessments (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  company_id BIGINT UNSIGNED NOT NULL,
  employee_id BIGINT UNSIGNED NOT NULL,
  department_id BIGINT UNSIGNED NOT NULL,
  assessor_user_id BIGINT UNSIGNED NOT NULL,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  rating SMALLINT NOT NULL,
  strengths VARCHAR(2000) NULL,
  improvements VARCHAR(2000) NULL,
  comments VARCHAR(2000) NULL,
  status ENUM('draft', 'shared') NOT NULL DEFAULT 'shared',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_performance_assessments_employee (employee_id, period_end),
  KEY idx_performance_assessments_department (department_id),
  CONSTRAINT fk_performance_assessments_company FOREIGN KEY (company_id) REFERENCES companies (id),
  CONSTRAINT fk_performance_assessments_employee FOREIGN KEY (employee_id) REFERENCES employees (id),
  CONSTRAINT fk_performance_assessments_department FOREIGN KEY (department_id) REFERENCES departments (id),
  CONSTRAINT fk_performance_assessments_user FOREIGN KEY (assessor_user_id) REFERENCES users (id),
  CONSTRAINT chk_performance_assessments_rating CHECK (rating BETWEEN 1 AND 5)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE department_register_entries (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  company_id BIGINT UNSIGNED NOT NULL,
  register_code VARCHAR(40) NOT NULL,
  reference_number VARCHAR(40) NOT NULL,
  department_id BIGINT UNSIGNED NULL,
  title VARCHAR(200) NOT NULL,
  status VARCHAR(40) NOT NULL,
  entry_date DATE NULL,
  due_on DATE NULL,
  amount DECIMAL(18, 2) NULL,
  quantity DECIMAL(18, 2) NULL,
  details JSON NOT NULL,
  created_by BIGINT UNSIGNED NOT NULL,
  updated_by BIGINT UNSIGNED NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_register_entries_reference (reference_number),
  KEY idx_register_entries_register (register_code, status, entry_date),
  KEY idx_register_entries_due (register_code, due_on),
  CONSTRAINT fk_register_entries_company FOREIGN KEY (company_id) REFERENCES companies (id),
  CONSTRAINT fk_register_entries_department FOREIGN KEY (department_id) REFERENCES departments (id),
  CONSTRAINT fk_register_entries_creator FOREIGN KEY (created_by) REFERENCES users (id),
  CONSTRAINT fk_register_entries_editor FOREIGN KEY (updated_by) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

UPDATE positions SET title = 'Finance Manager / Accounts Officer' WHERE code = 'ACCOUNTS-OFFICER' AND title = 'Accounts Officer';

UPDATE positions SET title = 'Head of Legal Affairs' WHERE code = 'LEGAL-OFFICER' AND title = 'Legal Officer';
