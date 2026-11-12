-- Payroll, legal records, operational monitoring, and CEO departmental checks.
-- Salary payments post a journal. Approved payroll figures are not edited in place.

CREATE TABLE employee_compensation (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  company_id BIGINT UNSIGNED NOT NULL,
  employee_id BIGINT UNSIGNED NOT NULL,
  effective_from DATE NOT NULL,
  basic_salary DECIMAL(14, 2) NOT NULL,
  allowances DECIMAL(14, 2) NOT NULL DEFAULT 0,
  deductions DECIMAL(14, 2) NOT NULL DEFAULT 0,
  notes VARCHAR(400) NULL,
  status ENUM('active', 'inactive') NOT NULL DEFAULT 'active',
  created_by BIGINT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_compensation_employee (employee_id, status),
  CONSTRAINT fk_compensation_company FOREIGN KEY (company_id) REFERENCES companies (id),
  CONSTRAINT fk_compensation_employee FOREIGN KEY (employee_id) REFERENCES employees (id),
  CONSTRAINT fk_compensation_user FOREIGN KEY (created_by) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE payroll_runs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  company_id BIGINT UNSIGNED NOT NULL,
  reference_number VARCHAR(40) NOT NULL,
  period_year SMALLINT NOT NULL,
  period_month TINYINT NOT NULL,
  status VARCHAR(40) NOT NULL,
  employee_count INT NOT NULL DEFAULT 0,
  total_basic DECIMAL(14, 2) NOT NULL DEFAULT 0,
  total_allowances DECIMAL(14, 2) NOT NULL DEFAULT 0,
  total_deductions DECIMAL(14, 2) NOT NULL DEFAULT 0,
  total_net DECIMAL(14, 2) NOT NULL DEFAULT 0,
  approval_request_id BIGINT UNSIGNED NULL,
  prepared_by BIGINT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_payroll_runs_reference (reference_number),
  KEY idx_payroll_runs_period (company_id, period_year, period_month, status),
  CONSTRAINT fk_payroll_runs_company FOREIGN KEY (company_id) REFERENCES companies (id),
  CONSTRAINT fk_payroll_runs_approval FOREIGN KEY (approval_request_id) REFERENCES approval_requests (id),
  CONSTRAINT fk_payroll_runs_user FOREIGN KEY (prepared_by) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE payroll_lines (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  payroll_run_id BIGINT UNSIGNED NOT NULL,
  employee_id BIGINT UNSIGNED NOT NULL,
  department_id BIGINT UNSIGNED NULL,
  basic_salary DECIMAL(14, 2) NOT NULL,
  allowances DECIMAL(14, 2) NOT NULL,
  deductions DECIMAL(14, 2) NOT NULL,
  net_pay DECIMAL(14, 2) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_payroll_lines_employee (payroll_run_id, employee_id),
  CONSTRAINT fk_payroll_lines_run FOREIGN KEY (payroll_run_id) REFERENCES payroll_runs (id),
  CONSTRAINT fk_payroll_lines_employee FOREIGN KEY (employee_id) REFERENCES employees (id),
  CONSTRAINT fk_payroll_lines_department FOREIGN KEY (department_id) REFERENCES departments (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE payroll_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  payroll_run_id BIGINT UNSIGNED NOT NULL,
  action VARCHAR(40) NOT NULL,
  from_status VARCHAR(40) NULL,
  to_status VARCHAR(40) NOT NULL,
  comment VARCHAR(500) NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_payroll_events_run (payroll_run_id, id),
  CONSTRAINT fk_payroll_events_run FOREIGN KEY (payroll_run_id) REFERENCES payroll_runs (id),
  CONSTRAINT fk_payroll_events_user FOREIGN KEY (user_id) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE salary_payments (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  company_id BIGINT UNSIGNED NOT NULL,
  reference_number VARCHAR(40) NOT NULL,
  payroll_run_id BIGINT UNSIGNED NOT NULL,
  payroll_line_id BIGINT UNSIGNED NOT NULL,
  employee_id BIGINT UNSIGNED NOT NULL,
  period_year SMALLINT NOT NULL,
  period_month TINYINT NOT NULL,
  amount DECIMAL(14, 2) NOT NULL,
  status ENUM('paid', 'failed') NOT NULL,
  payment_date DATE NULL,
  journal_id BIGINT UNSIGNED NULL,
  failure_reason VARCHAR(400) NULL,
  paid_by BIGINT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_salary_payments_reference (reference_number),
  KEY idx_salary_employee_period (employee_id, period_year, period_month, status),
  CONSTRAINT fk_salary_payments_company FOREIGN KEY (company_id) REFERENCES companies (id),
  CONSTRAINT fk_salary_payments_run FOREIGN KEY (payroll_run_id) REFERENCES payroll_runs (id),
  CONSTRAINT fk_salary_payments_line FOREIGN KEY (payroll_line_id) REFERENCES payroll_lines (id),
  CONSTRAINT fk_salary_payments_employee FOREIGN KEY (employee_id) REFERENCES employees (id),
  CONSTRAINT fk_salary_payments_journal FOREIGN KEY (journal_id) REFERENCES journals (id),
  CONSTRAINT fk_salary_payments_user FOREIGN KEY (paid_by) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE legal_documents (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  company_id BIGINT UNSIGNED NOT NULL,
  reference_number VARCHAR(40) NOT NULL,
  document_type ENUM('contract', 'mou', 'agreement') NOT NULL,
  title VARCHAR(200) NOT NULL,
  counterparty VARCHAR(200) NOT NULL,
  department_id BIGINT UNSIGNED NOT NULL,
  effective_on DATE NULL,
  expiry_on DATE NULL,
  status VARCHAR(40) NOT NULL,
  custody_note VARCHAR(500) NULL,
  summary VARCHAR(2000) NOT NULL,
  approval_request_id BIGINT UNSIGNED NULL,
  cleared_at DATETIME(3) NULL,
  created_by BIGINT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_legal_documents_reference (reference_number),
  KEY idx_legal_documents_expiry (expiry_on, status),
  CONSTRAINT fk_legal_documents_company FOREIGN KEY (company_id) REFERENCES companies (id),
  CONSTRAINT fk_legal_documents_department FOREIGN KEY (department_id) REFERENCES departments (id),
  CONSTRAINT fk_legal_documents_approval FOREIGN KEY (approval_request_id) REFERENCES approval_requests (id),
  CONSTRAINT fk_legal_documents_user FOREIGN KEY (created_by) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE legal_obligations (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  document_id BIGINT UNSIGNED NOT NULL,
  description VARCHAR(400) NOT NULL,
  due_on DATE NOT NULL,
  status ENUM('open', 'met', 'overdue') NOT NULL DEFAULT 'open',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_legal_obligations_due (due_on, status),
  CONSTRAINT fk_legal_obligations_document FOREIGN KEY (document_id) REFERENCES legal_documents (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE legal_comments (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  document_id BIGINT UNSIGNED NOT NULL,
  recommendation ENUM('recommend', 'amend', 'concern') NOT NULL,
  comment VARCHAR(1000) NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_legal_comments_document (document_id, id),
  CONSTRAINT fk_legal_comments_document FOREIGN KEY (document_id) REFERENCES legal_documents (id),
  CONSTRAINT fk_legal_comments_user FOREIGN KEY (user_id) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE legal_risks (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  company_id BIGINT UNSIGNED NOT NULL,
  reference_number VARCHAR(40) NOT NULL,
  title VARCHAR(200) NOT NULL,
  description VARCHAR(2000) NOT NULL,
  likelihood ENUM('low', 'medium', 'high') NOT NULL,
  impact ENUM('low', 'medium', 'high') NOT NULL,
  status ENUM('open', 'monitoring', 'closed') NOT NULL DEFAULT 'open',
  department_id BIGINT UNSIGNED NULL,
  created_by BIGINT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_legal_risks_reference (reference_number),
  CONSTRAINT fk_legal_risks_company FOREIGN KEY (company_id) REFERENCES companies (id),
  CONSTRAINT fk_legal_risks_department FOREIGN KEY (department_id) REFERENCES departments (id),
  CONSTRAINT fk_legal_risks_user FOREIGN KEY (created_by) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE operational_activities (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  company_id BIGINT UNSIGNED NOT NULL,
  reference_number VARCHAR(40) NOT NULL,
  activity_date DATE NOT NULL,
  area ENUM('daily', 'procurement', 'loading', 'farm', 'haulage', 'inventory', 'other') NOT NULL,
  department_id BIGINT UNSIGNED NOT NULL,
  summary VARCHAR(500) NOT NULL,
  recorded_by BIGINT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_operational_activities_reference (reference_number),
  KEY idx_operational_activities_area (area, activity_date),
  CONSTRAINT fk_operational_activities_company FOREIGN KEY (company_id) REFERENCES companies (id),
  CONSTRAINT fk_operational_activities_department FOREIGN KEY (department_id) REFERENCES departments (id),
  CONSTRAINT fk_operational_activities_user FOREIGN KEY (recorded_by) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE operational_tasks (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  company_id BIGINT UNSIGNED NOT NULL,
  reference_number VARCHAR(40) NOT NULL,
  title VARCHAR(200) NOT NULL,
  area ENUM('daily', 'procurement', 'loading', 'farm', 'haulage', 'inventory', 'other') NOT NULL,
  department_id BIGINT UNSIGNED NOT NULL,
  due_on DATE NULL,
  status ENUM('open', 'in_progress', 'done') NOT NULL DEFAULT 'open',
  assigned_to_user_id BIGINT UNSIGNED NULL,
  notes VARCHAR(1000) NULL,
  created_by BIGINT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_operational_tasks_reference (reference_number),
  CONSTRAINT fk_operational_tasks_company FOREIGN KEY (company_id) REFERENCES companies (id),
  CONSTRAINT fk_operational_tasks_department FOREIGN KEY (department_id) REFERENCES departments (id),
  CONSTRAINT fk_operational_tasks_assignee FOREIGN KEY (assigned_to_user_id) REFERENCES users (id),
  CONSTRAINT fk_operational_tasks_user FOREIGN KEY (created_by) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE operational_issues (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  company_id BIGINT UNSIGNED NOT NULL,
  reference_number VARCHAR(40) NOT NULL,
  title VARCHAR(200) NOT NULL,
  description VARCHAR(2000) NOT NULL,
  area ENUM('daily', 'procurement', 'loading', 'farm', 'haulage', 'inventory', 'other') NOT NULL,
  department_id BIGINT UNSIGNED NOT NULL,
  severity ENUM('low', 'medium', 'high') NOT NULL,
  status ENUM('open', 'monitoring', 'resolved') NOT NULL DEFAULT 'open',
  escalated TINYINT(1) NOT NULL DEFAULT 0,
  reported_by BIGINT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_operational_issues_reference (reference_number),
  KEY idx_operational_issues_escalated (escalated, status),
  CONSTRAINT fk_operational_issues_company FOREIGN KEY (company_id) REFERENCES companies (id),
  CONSTRAINT fk_operational_issues_department FOREIGN KEY (department_id) REFERENCES departments (id),
  CONSTRAINT fk_operational_issues_user FOREIGN KEY (reported_by) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE departmental_reviews (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  company_id BIGINT UNSIGNED NOT NULL,
  reference_number VARCHAR(40) NOT NULL,
  department_id BIGINT UNSIGNED NOT NULL,
  review_date DATE NOT NULL,
  status ENUM('open', 'closed') NOT NULL DEFAULT 'open',
  summary VARCHAR(2000) NOT NULL,
  reviewer_user_id BIGINT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_departmental_reviews_reference (reference_number),
  CONSTRAINT fk_departmental_reviews_company FOREIGN KEY (company_id) REFERENCES companies (id),
  CONSTRAINT fk_departmental_reviews_department FOREIGN KEY (department_id) REFERENCES departments (id),
  CONSTRAINT fk_departmental_reviews_user FOREIGN KEY (reviewer_user_id) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE management_findings (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  review_id BIGINT UNSIGNED NOT NULL,
  description VARCHAR(1000) NOT NULL,
  severity ENUM('low', 'medium', 'high') NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  CONSTRAINT fk_management_findings_review FOREIGN KEY (review_id) REFERENCES departmental_reviews (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE corrective_actions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  company_id BIGINT UNSIGNED NOT NULL,
  reference_number VARCHAR(40) NOT NULL,
  review_id BIGINT UNSIGNED NOT NULL,
  finding_id BIGINT UNSIGNED NULL,
  department_id BIGINT UNSIGNED NOT NULL,
  title VARCHAR(200) NOT NULL,
  due_on DATE NOT NULL,
  status ENUM('open', 'responded', 'resolved', 'outstanding') NOT NULL DEFAULT 'open',
  assigned_to_user_id BIGINT UNSIGNED NOT NULL,
  response VARCHAR(2000) NULL,
  review_note VARCHAR(1000) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_corrective_actions_reference (reference_number),
  CONSTRAINT fk_corrective_actions_company FOREIGN KEY (company_id) REFERENCES companies (id),
  CONSTRAINT fk_corrective_actions_review FOREIGN KEY (review_id) REFERENCES departmental_reviews (id),
  CONSTRAINT fk_corrective_actions_finding FOREIGN KEY (finding_id) REFERENCES management_findings (id),
  CONSTRAINT fk_corrective_actions_department FOREIGN KEY (department_id) REFERENCES departments (id),
  CONSTRAINT fk_corrective_actions_user FOREIGN KEY (assigned_to_user_id) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE management_meetings (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  company_id BIGINT UNSIGNED NOT NULL,
  reference_number VARCHAR(40) NOT NULL,
  held_on DATE NOT NULL,
  title VARCHAR(200) NOT NULL,
  notes VARCHAR(4000) NOT NULL,
  created_by BIGINT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_management_meetings_reference (reference_number),
  CONSTRAINT fk_management_meetings_company FOREIGN KEY (company_id) REFERENCES companies (id),
  CONSTRAINT fk_management_meetings_user FOREIGN KEY (created_by) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE meeting_actions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  meeting_id BIGINT UNSIGNED NOT NULL,
  description VARCHAR(400) NOT NULL,
  department_id BIGINT UNSIGNED NOT NULL,
  due_on DATE NULL,
  status ENUM('open', 'done') NOT NULL DEFAULT 'open',
  PRIMARY KEY (id),
  CONSTRAINT fk_meeting_actions_meeting FOREIGN KEY (meeting_id) REFERENCES management_meetings (id),
  CONSTRAINT fk_meeting_actions_department FOREIGN KEY (department_id) REFERENCES departments (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO ledger_accounts (company_id, code, name, account_type, status)
SELECT id, '5100', 'Salaries', 'expense', 'active' FROM companies
ON DUPLICATE KEY UPDATE name = VALUES(name);

INSERT INTO department_workspaces (department_id, workspace_code)
SELECT id, 'operations' FROM departments WHERE code = 'OPS'
ON DUPLICATE KEY UPDATE workspace_code = workspace_code;
