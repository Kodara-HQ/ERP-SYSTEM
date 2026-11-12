-- Phase 5 finance. Payment requests use the PAYMENT route and budgets use the BUDGET route.
-- A posted journal is history. Amounts are not edited; a correction is a new reversing journal.

CREATE TABLE ledger_accounts (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  company_id BIGINT UNSIGNED NOT NULL,
  code VARCHAR(20) NOT NULL,
  name VARCHAR(160) NOT NULL,
  account_type ENUM('asset', 'liability', 'equity', 'income', 'expense') NOT NULL,
  postable TINYINT(1) NOT NULL DEFAULT 1,
  status ENUM('active', 'inactive') NOT NULL DEFAULT 'active',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_ledger_accounts_code (company_id, code),
  CONSTRAINT fk_ledger_accounts_company FOREIGN KEY (company_id) REFERENCES companies (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE cash_accounts (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  company_id BIGINT UNSIGNED NOT NULL,
  code VARCHAR(20) NOT NULL,
  name VARCHAR(160) NOT NULL,
  kind ENUM('bank', 'petty', 'cash') NOT NULL,
  ledger_account_id BIGINT UNSIGNED NOT NULL,
  status ENUM('active', 'inactive') NOT NULL DEFAULT 'active',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_cash_accounts_code (company_id, code),
  CONSTRAINT fk_cash_accounts_company FOREIGN KEY (company_id) REFERENCES companies (id),
  CONSTRAINT fk_cash_accounts_ledger FOREIGN KEY (ledger_account_id) REFERENCES ledger_accounts (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE journals (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  company_id BIGINT UNSIGNED NOT NULL,
  reference_number VARCHAR(40) NOT NULL,
  journal_date DATE NOT NULL,
  description VARCHAR(400) NOT NULL,
  source_type VARCHAR(40) NULL,
  source_id BIGINT UNSIGNED NULL,
  reverses_journal_id BIGINT UNSIGNED NULL,
  created_by BIGINT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_journals_reference (reference_number),
  KEY idx_journals_date (company_id, journal_date),
  KEY idx_journals_source (source_type, source_id),
  CONSTRAINT fk_journals_company FOREIGN KEY (company_id) REFERENCES companies (id),
  CONSTRAINT fk_journals_reversal FOREIGN KEY (reverses_journal_id) REFERENCES journals (id),
  CONSTRAINT fk_journals_user FOREIGN KEY (created_by) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE journal_lines (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  journal_id BIGINT UNSIGNED NOT NULL,
  ledger_account_id BIGINT UNSIGNED NOT NULL,
  department_id BIGINT UNSIGNED NULL,
  debit DECIMAL(14, 2) NOT NULL DEFAULT 0,
  credit DECIMAL(14, 2) NOT NULL DEFAULT 0,
  memo VARCHAR(200) NULL,
  cleared_on DATE NULL,
  PRIMARY KEY (id),
  KEY idx_journal_lines_account (ledger_account_id),
  KEY idx_journal_lines_journal (journal_id),
  CONSTRAINT fk_journal_lines_journal FOREIGN KEY (journal_id) REFERENCES journals (id),
  CONSTRAINT fk_journal_lines_account FOREIGN KEY (ledger_account_id) REFERENCES ledger_accounts (id),
  CONSTRAINT fk_journal_lines_department FOREIGN KEY (department_id) REFERENCES departments (id),
  CONSTRAINT chk_journal_lines_amount CHECK (
    debit >= 0 AND credit >= 0 AND NOT (debit > 0 AND credit > 0) AND (debit > 0 OR credit > 0)
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE customers (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  company_id BIGINT UNSIGNED NOT NULL,
  reference_number VARCHAR(40) NOT NULL,
  name VARCHAR(160) NOT NULL,
  status ENUM('active', 'inactive') NOT NULL DEFAULT 'active',
  created_by BIGINT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_customers_reference (reference_number),
  KEY idx_customers_name (company_id, name),
  CONSTRAINT fk_customers_company FOREIGN KEY (company_id) REFERENCES companies (id),
  CONSTRAINT fk_customers_user FOREIGN KEY (created_by) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE customer_invoices (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  company_id BIGINT UNSIGNED NOT NULL,
  reference_number VARCHAR(40) NOT NULL,
  customer_id BIGINT UNSIGNED NOT NULL,
  invoice_date DATE NOT NULL,
  description VARCHAR(400) NOT NULL,
  amount DECIMAL(14, 2) NOT NULL,
  outstanding DECIMAL(14, 2) NOT NULL,
  status ENUM('open', 'paid', 'void') NOT NULL DEFAULT 'open',
  journal_id BIGINT UNSIGNED NOT NULL,
  created_by BIGINT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_customer_invoices_reference (reference_number),
  CONSTRAINT fk_customer_invoices_company FOREIGN KEY (company_id) REFERENCES companies (id),
  CONSTRAINT fk_customer_invoices_customer FOREIGN KEY (customer_id) REFERENCES customers (id),
  CONSTRAINT fk_customer_invoices_journal FOREIGN KEY (journal_id) REFERENCES journals (id),
  CONSTRAINT fk_customer_invoices_user FOREIGN KEY (created_by) REFERENCES users (id),
  CONSTRAINT chk_customer_invoices_amount CHECK (amount > 0 AND outstanding >= 0 AND outstanding <= amount)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE customer_receipts (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  customer_invoice_id BIGINT UNSIGNED NOT NULL,
  cash_account_id BIGINT UNSIGNED NOT NULL,
  amount DECIMAL(14, 2) NOT NULL,
  received_on DATE NOT NULL,
  journal_id BIGINT UNSIGNED NOT NULL,
  created_by BIGINT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  CONSTRAINT fk_customer_receipts_invoice FOREIGN KEY (customer_invoice_id) REFERENCES customer_invoices (id),
  CONSTRAINT fk_customer_receipts_cash FOREIGN KEY (cash_account_id) REFERENCES cash_accounts (id),
  CONSTRAINT fk_customer_receipts_journal FOREIGN KEY (journal_id) REFERENCES journals (id),
  CONSTRAINT fk_customer_receipts_user FOREIGN KEY (created_by) REFERENCES users (id),
  CONSTRAINT chk_customer_receipts_amount CHECK (amount > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE payment_requests (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  company_id BIGINT UNSIGNED NOT NULL,
  reference_number VARCHAR(40) NOT NULL,
  requester_user_id BIGINT UNSIGNED NOT NULL,
  department_id BIGINT UNSIGNED NULL,
  branch_id BIGINT UNSIGNED NULL,
  payee VARCHAR(160) NOT NULL,
  purpose VARCHAR(400) NOT NULL,
  amount DECIMAL(14, 2) NOT NULL,
  expense_account_id BIGINT UNSIGNED NOT NULL,
  cash_account_id BIGINT UNSIGNED NOT NULL,
  supplier_invoice_id BIGINT UNSIGNED NULL,
  status ENUM('submitted', 'returned', 'approved', 'rejected', 'cancelled', 'paid') NOT NULL DEFAULT 'submitted',
  approval_request_id BIGINT UNSIGNED NULL,
  journal_id BIGINT UNSIGNED NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_payment_requests_reference (reference_number),
  KEY idx_payment_requests_status (status),
  CONSTRAINT fk_payment_requests_company FOREIGN KEY (company_id) REFERENCES companies (id),
  CONSTRAINT fk_payment_requests_user FOREIGN KEY (requester_user_id) REFERENCES users (id),
  CONSTRAINT fk_payment_requests_department FOREIGN KEY (department_id) REFERENCES departments (id),
  CONSTRAINT fk_payment_requests_branch FOREIGN KEY (branch_id) REFERENCES branches (id),
  CONSTRAINT fk_payment_requests_expense FOREIGN KEY (expense_account_id) REFERENCES ledger_accounts (id),
  CONSTRAINT fk_payment_requests_cash FOREIGN KEY (cash_account_id) REFERENCES cash_accounts (id),
  CONSTRAINT fk_payment_requests_invoice FOREIGN KEY (supplier_invoice_id) REFERENCES supplier_invoices (id),
  CONSTRAINT fk_payment_requests_approval FOREIGN KEY (approval_request_id) REFERENCES approval_requests (id),
  CONSTRAINT fk_payment_requests_journal FOREIGN KEY (journal_id) REFERENCES journals (id),
  CONSTRAINT chk_payment_requests_amount CHECK (amount > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE budgets (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  company_id BIGINT UNSIGNED NOT NULL,
  reference_number VARCHAR(40) NOT NULL,
  requester_user_id BIGINT UNSIGNED NOT NULL,
  department_id BIGINT UNSIGNED NOT NULL,
  ledger_account_id BIGINT UNSIGNED NOT NULL,
  budget_year SMALLINT UNSIGNED NOT NULL,
  amount DECIMAL(14, 2) NOT NULL,
  purpose VARCHAR(400) NOT NULL,
  status ENUM('submitted', 'returned', 'approved', 'rejected', 'cancelled') NOT NULL DEFAULT 'submitted',
  approval_request_id BIGINT UNSIGNED NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_budgets_reference (reference_number),
  KEY idx_budgets_year (department_id, budget_year),
  CONSTRAINT fk_budgets_company FOREIGN KEY (company_id) REFERENCES companies (id),
  CONSTRAINT fk_budgets_user FOREIGN KEY (requester_user_id) REFERENCES users (id),
  CONSTRAINT fk_budgets_department FOREIGN KEY (department_id) REFERENCES departments (id),
  CONSTRAINT fk_budgets_account FOREIGN KEY (ledger_account_id) REFERENCES ledger_accounts (id),
  CONSTRAINT fk_budgets_approval FOREIGN KEY (approval_request_id) REFERENCES approval_requests (id),
  CONSTRAINT chk_budgets_amount CHECK (amount > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE reconciliations (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  cash_account_id BIGINT UNSIGNED NOT NULL,
  statement_date DATE NOT NULL,
  statement_balance DECIMAL(14, 2) NOT NULL,
  cleared_balance DECIMAL(14, 2) NOT NULL,
  difference DECIMAL(14, 2) NOT NULL,
  created_by BIGINT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_reconciliations_cash (cash_account_id, statement_date),
  CONSTRAINT fk_reconciliations_cash FOREIGN KEY (cash_account_id) REFERENCES cash_accounts (id),
  CONSTRAINT fk_reconciliations_user FOREIGN KEY (created_by) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE supplier_invoices
  ADD COLUMN journal_id BIGINT UNSIGNED NULL AFTER recorded_by,
  ADD COLUMN outstanding DECIMAL(14, 2) NULL AFTER amount,
  ADD KEY idx_supplier_invoices_journal (journal_id),
  ADD CONSTRAINT fk_supplier_invoices_journal FOREIGN KEY (journal_id) REFERENCES journals (id);

UPDATE supplier_invoices SET outstanding = amount WHERE outstanding IS NULL;

ALTER TABLE supplier_invoices
  MODIFY outstanding DECIMAL(14, 2) NOT NULL,
  ADD CONSTRAINT chk_supplier_invoices_outstanding CHECK (outstanding >= 0 AND outstanding <= amount);

INSERT INTO reference_sequences (sequence_key, next_value) VALUES
  ('journal', 1),
  ('payment_request', 1),
  ('budget', 1),
  ('customer', 1),
  ('customer_invoice', 1)
ON DUPLICATE KEY UPDATE sequence_key = sequence_key;

INSERT INTO system_settings (setting_key, setting_value) VALUES
  ('journal_prefix', JSON_QUOTE('BJG-JNL')),
  ('payment_request_prefix', JSON_QUOTE('BJG-PAY')),
  ('budget_prefix', JSON_QUOTE('BJG-BUD')),
  ('customer_prefix', JSON_QUOTE('BJG-CUS')),
  ('customer_invoice_prefix', JSON_QUOTE('BJG-CIV'))
ON DUPLICATE KEY UPDATE setting_key = setting_key;
