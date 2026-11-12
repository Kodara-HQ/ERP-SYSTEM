-- Phase 3 human resources. Leave and recruitment use the central approval engine.

ALTER TABLE approval_requests
  ADD COLUMN source_type VARCHAR(40) NULL AFTER requester_user_id,
  ADD COLUMN source_id BIGINT UNSIGNED NULL AFTER source_type,
  ADD KEY idx_approval_requests_source (source_type, source_id);

CREATE TABLE leave_types (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  company_id BIGINT UNSIGNED NOT NULL,
  code VARCHAR(30) NOT NULL,
  name VARCHAR(120) NOT NULL,
  days_per_year DECIMAL(5, 1) NOT NULL DEFAULT 0,
  paid TINYINT(1) NOT NULL DEFAULT 1,
  status ENUM('active', 'inactive') NOT NULL DEFAULT 'active',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_leave_types_code (company_id, code),
  CONSTRAINT fk_leave_types_company FOREIGN KEY (company_id) REFERENCES companies (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE leave_balances (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  employee_id BIGINT UNSIGNED NOT NULL,
  leave_type_id BIGINT UNSIGNED NOT NULL,
  balance_year SMALLINT UNSIGNED NOT NULL,
  entitled DECIMAL(6, 1) NOT NULL,
  used DECIMAL(6, 1) NOT NULL DEFAULT 0,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_leave_balances (employee_id, leave_type_id, balance_year),
  CONSTRAINT fk_leave_balances_employee FOREIGN KEY (employee_id) REFERENCES employees (id),
  CONSTRAINT fk_leave_balances_type FOREIGN KEY (leave_type_id) REFERENCES leave_types (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE leave_requests (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  employee_id BIGINT UNSIGNED NOT NULL,
  leave_type_id BIGINT UNSIGNED NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  days DECIMAL(5, 1) NOT NULL,
  reason VARCHAR(500) NOT NULL,
  status ENUM('draft', 'submitted', 'returned', 'approved', 'rejected', 'cancelled') NOT NULL DEFAULT 'draft',
  approval_request_id BIGINT UNSIGNED NULL,
  balance_applied TINYINT(1) NOT NULL DEFAULT 0,
  created_by BIGINT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_leave_requests_employee (employee_id, status),
  KEY idx_leave_requests_dates (start_date, end_date),
  CONSTRAINT fk_leave_requests_employee FOREIGN KEY (employee_id) REFERENCES employees (id),
  CONSTRAINT fk_leave_requests_type FOREIGN KEY (leave_type_id) REFERENCES leave_types (id),
  CONSTRAINT fk_leave_requests_approval FOREIGN KEY (approval_request_id) REFERENCES approval_requests (id),
  CONSTRAINT fk_leave_requests_user FOREIGN KEY (created_by) REFERENCES users (id),
  CONSTRAINT chk_leave_dates CHECK (end_date >= start_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE attendance_records (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  employee_id BIGINT UNSIGNED NOT NULL,
  work_date DATE NOT NULL,
  attendance_status ENUM('present', 'absent', 'leave', 'off') NOT NULL,
  check_in TIME NULL,
  check_out TIME NULL,
  notes VARCHAR(300) NULL,
  recorded_by BIGINT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_attendance_day (employee_id, work_date),
  KEY idx_attendance_date (work_date),
  CONSTRAINT fk_attendance_employee FOREIGN KEY (employee_id) REFERENCES employees (id),
  CONSTRAINT fk_attendance_user FOREIGN KEY (recorded_by) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE vacancies (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  company_id BIGINT UNSIGNED NOT NULL,
  title VARCHAR(160) NOT NULL,
  department_id BIGINT UNSIGNED NOT NULL,
  position_id BIGINT UNSIGNED NOT NULL,
  branch_id BIGINT UNSIGNED NOT NULL,
  openings INT UNSIGNED NOT NULL DEFAULT 1,
  description VARCHAR(1000) NULL,
  status ENUM('draft', 'pending_approval', 'open', 'closed', 'rejected', 'returned') NOT NULL DEFAULT 'draft',
  approval_request_id BIGINT UNSIGNED NULL,
  created_by BIGINT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_vacancies_status (status),
  CONSTRAINT fk_vacancies_company FOREIGN KEY (company_id) REFERENCES companies (id),
  CONSTRAINT fk_vacancies_department FOREIGN KEY (department_id) REFERENCES departments (id),
  CONSTRAINT fk_vacancies_position FOREIGN KEY (position_id) REFERENCES positions (id),
  CONSTRAINT fk_vacancies_branch FOREIGN KEY (branch_id) REFERENCES branches (id),
  CONSTRAINT fk_vacancies_approval FOREIGN KEY (approval_request_id) REFERENCES approval_requests (id),
  CONSTRAINT fk_vacancies_user FOREIGN KEY (created_by) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE applicants (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  vacancy_id BIGINT UNSIGNED NOT NULL,
  first_name VARCHAR(80) NOT NULL,
  last_name VARCHAR(80) NOT NULL,
  email VARCHAR(180) NULL,
  phone VARCHAR(40) NULL,
  status ENUM('applied', 'shortlisted', 'rejected', 'hired') NOT NULL DEFAULT 'applied',
  employee_id BIGINT UNSIGNED NULL,
  notes VARCHAR(500) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_applicants_vacancy (vacancy_id, status),
  CONSTRAINT fk_applicants_vacancy FOREIGN KEY (vacancy_id) REFERENCES vacancies (id),
  CONSTRAINT fk_applicants_employee FOREIGN KEY (employee_id) REFERENCES employees (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE employment_contracts (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  employee_id BIGINT UNSIGNED NOT NULL,
  contract_type ENUM('permanent', 'fixed_term', 'temporary', 'casual', 'intern') NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NULL,
  status ENUM('active', 'ended') NOT NULL DEFAULT 'active',
  notes VARCHAR(500) NULL,
  created_by BIGINT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_contracts_employee (employee_id, status),
  CONSTRAINT fk_contracts_employee FOREIGN KEY (employee_id) REFERENCES employees (id),
  CONSTRAINT fk_contracts_user FOREIGN KEY (created_by) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE promotions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  employee_id BIGINT UNSIGNED NOT NULL,
  from_position_id BIGINT UNSIGNED NULL,
  to_position_id BIGINT UNSIGNED NOT NULL,
  from_department_id BIGINT UNSIGNED NULL,
  to_department_id BIGINT UNSIGNED NOT NULL,
  effective_date DATE NOT NULL,
  reason VARCHAR(300) NOT NULL,
  created_by BIGINT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_promotions_employee (employee_id, effective_date),
  CONSTRAINT fk_promotions_employee FOREIGN KEY (employee_id) REFERENCES employees (id),
  CONSTRAINT fk_promotions_from_position FOREIGN KEY (from_position_id) REFERENCES positions (id),
  CONSTRAINT fk_promotions_to_position FOREIGN KEY (to_position_id) REFERENCES positions (id),
  CONSTRAINT fk_promotions_from_department FOREIGN KEY (from_department_id) REFERENCES departments (id),
  CONSTRAINT fk_promotions_to_department FOREIGN KEY (to_department_id) REFERENCES departments (id),
  CONSTRAINT fk_promotions_user FOREIGN KEY (created_by) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE disciplinary_records (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  employee_id BIGINT UNSIGNED NOT NULL,
  incident_date DATE NOT NULL,
  category VARCHAR(80) NOT NULL,
  description VARCHAR(1000) NOT NULL,
  action_taken VARCHAR(500) NULL,
  status ENUM('open', 'closed') NOT NULL DEFAULT 'open',
  created_by BIGINT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_disciplinary_employee (employee_id, status),
  CONSTRAINT fk_disciplinary_employee FOREIGN KEY (employee_id) REFERENCES employees (id),
  CONSTRAINT fk_disciplinary_user FOREIGN KEY (created_by) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE appraisals (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  employee_id BIGINT UNSIGNED NOT NULL,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  rating DECIMAL(3, 1) NOT NULL,
  summary VARCHAR(1000) NOT NULL,
  appraiser_user_id BIGINT UNSIGNED NOT NULL,
  status ENUM('draft', 'final') NOT NULL DEFAULT 'final',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_appraisals_employee (employee_id, period_end),
  CONSTRAINT fk_appraisals_employee FOREIGN KEY (employee_id) REFERENCES employees (id),
  CONSTRAINT fk_appraisals_user FOREIGN KEY (appraiser_user_id) REFERENCES users (id),
  CONSTRAINT chk_appraisal_period CHECK (period_end >= period_start),
  CONSTRAINT chk_appraisal_rating CHECK (rating >= 1 AND rating <= 5)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE training_records (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  employee_id BIGINT UNSIGNED NOT NULL,
  course_name VARCHAR(180) NOT NULL,
  provider VARCHAR(160) NULL,
  start_date DATE NOT NULL,
  end_date DATE NULL,
  status ENUM('planned', 'completed', 'cancelled') NOT NULL DEFAULT 'planned',
  result VARCHAR(120) NULL,
  created_by BIGINT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_training_employee (employee_id, status),
  CONSTRAINT fk_training_employee FOREIGN KEY (employee_id) REFERENCES employees (id),
  CONSTRAINT fk_training_user FOREIGN KEY (created_by) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE onboarding_tasks (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  employee_id BIGINT UNSIGNED NOT NULL,
  title VARCHAR(180) NOT NULL,
  due_date DATE NULL,
  completed_at DATETIME(3) NULL,
  notes VARCHAR(300) NULL,
  created_by BIGINT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_onboarding_employee (employee_id, completed_at),
  CONSTRAINT fk_onboarding_employee FOREIGN KEY (employee_id) REFERENCES employees (id),
  CONSTRAINT fk_onboarding_user FOREIGN KEY (created_by) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE exit_records (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  employee_id BIGINT UNSIGNED NOT NULL,
  exit_date DATE NOT NULL,
  reason VARCHAR(500) NOT NULL,
  clearance_status ENUM('pending', 'cleared') NOT NULL DEFAULT 'pending',
  created_by BIGINT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_exit_employee (employee_id),
  CONSTRAINT fk_exit_employee FOREIGN KEY (employee_id) REFERENCES employees (id),
  CONSTRAINT fk_exit_user FOREIGN KEY (created_by) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
