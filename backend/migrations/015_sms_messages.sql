-- Outgoing SMS. Messages are queued inside the business transaction and sent after it commits,
-- so a provider outage never blocks or rolls back a salary payment.

CREATE TABLE sms_messages (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  company_id BIGINT UNSIGNED NOT NULL,
  employee_id BIGINT UNSIGNED NULL,
  purpose VARCHAR(40) NOT NULL,
  source_type VARCHAR(60) NULL,
  source_id VARCHAR(40) NULL,
  payroll_line_id BIGINT UNSIGNED NULL,
  recipient VARCHAR(20) NULL,
  message VARCHAR(480) NOT NULL,
  status ENUM('queued', 'sent', 'failed', 'skipped') NOT NULL DEFAULT 'queued',
  provider VARCHAR(30) NULL,
  provider_message_id VARCHAR(120) NULL,
  attempts INT NOT NULL DEFAULT 0,
  last_error VARCHAR(400) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  sent_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  KEY idx_sms_status (status, created_at),
  KEY idx_sms_payroll_line (payroll_line_id),
  CONSTRAINT fk_sms_company FOREIGN KEY (company_id) REFERENCES companies (id),
  CONSTRAINT fk_sms_employee FOREIGN KEY (employee_id) REFERENCES employees (id),
  CONSTRAINT fk_sms_payroll_line FOREIGN KEY (payroll_line_id) REFERENCES payroll_lines (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
