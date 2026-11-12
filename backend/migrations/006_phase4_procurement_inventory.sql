-- Phase 4 procurement and inventory. Purchase requisitions use the central PURCHASE route.
-- Stock quantity changes only through stock_movements, in the same transaction as the balance.

CREATE TABLE suppliers (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  company_id BIGINT UNSIGNED NOT NULL,
  reference_number VARCHAR(40) NOT NULL,
  name VARCHAR(160) NOT NULL,
  contact_name VARCHAR(120) NULL,
  phone VARCHAR(40) NULL,
  email VARCHAR(180) NULL,
  notes VARCHAR(400) NULL,
  status ENUM('active', 'inactive') NOT NULL DEFAULT 'active',
  created_by BIGINT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_suppliers_reference (reference_number),
  KEY idx_suppliers_name (company_id, name),
  CONSTRAINT fk_suppliers_company FOREIGN KEY (company_id) REFERENCES companies (id),
  CONSTRAINT fk_suppliers_user FOREIGN KEY (created_by) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE stock_categories (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  company_id BIGINT UNSIGNED NOT NULL,
  name VARCHAR(120) NOT NULL,
  status ENUM('active', 'inactive') NOT NULL DEFAULT 'active',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_stock_categories_name (company_id, name),
  CONSTRAINT fk_stock_categories_company FOREIGN KEY (company_id) REFERENCES companies (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE warehouses (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  company_id BIGINT UNSIGNED NOT NULL,
  code VARCHAR(30) NOT NULL,
  name VARCHAR(160) NOT NULL,
  branch_id BIGINT UNSIGNED NULL,
  notes VARCHAR(400) NULL,
  status ENUM('active', 'inactive') NOT NULL DEFAULT 'active',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_warehouses_code (company_id, code),
  CONSTRAINT fk_warehouses_company FOREIGN KEY (company_id) REFERENCES companies (id),
  CONSTRAINT fk_warehouses_branch FOREIGN KEY (branch_id) REFERENCES branches (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE stock_items (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  company_id BIGINT UNSIGNED NOT NULL,
  sku VARCHAR(40) NOT NULL,
  name VARCHAR(160) NOT NULL,
  category_id BIGINT UNSIGNED NULL,
  unit VARCHAR(20) NOT NULL DEFAULT 'unit',
  reorder_level DECIMAL(14, 3) NOT NULL DEFAULT 0,
  status ENUM('active', 'inactive') NOT NULL DEFAULT 'active',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_stock_items_sku (company_id, sku),
  KEY idx_stock_items_name (company_id, name),
  CONSTRAINT fk_stock_items_company FOREIGN KEY (company_id) REFERENCES companies (id),
  CONSTRAINT fk_stock_items_category FOREIGN KEY (category_id) REFERENCES stock_categories (id),
  CONSTRAINT chk_stock_items_reorder CHECK (reorder_level >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE stock_balances (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  warehouse_id BIGINT UNSIGNED NOT NULL,
  item_id BIGINT UNSIGNED NOT NULL,
  quantity DECIMAL(14, 3) NOT NULL DEFAULT 0,
  average_cost DECIMAL(14, 2) NOT NULL DEFAULT 0,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_stock_balances (warehouse_id, item_id),
  CONSTRAINT fk_stock_balances_warehouse FOREIGN KEY (warehouse_id) REFERENCES warehouses (id),
  CONSTRAINT fk_stock_balances_item FOREIGN KEY (item_id) REFERENCES stock_items (id),
  CONSTRAINT chk_stock_balances_qty CHECK (quantity >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE stock_lots (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  warehouse_id BIGINT UNSIGNED NOT NULL,
  item_id BIGINT UNSIGNED NOT NULL,
  lot_code VARCHAR(40) NOT NULL,
  expiry_date DATE NULL,
  quantity DECIMAL(14, 3) NOT NULL DEFAULT 0,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_stock_lots (warehouse_id, item_id, lot_code),
  KEY idx_stock_lots_expiry (expiry_date, quantity),
  CONSTRAINT fk_stock_lots_warehouse FOREIGN KEY (warehouse_id) REFERENCES warehouses (id),
  CONSTRAINT fk_stock_lots_item FOREIGN KEY (item_id) REFERENCES stock_items (id),
  CONSTRAINT chk_stock_lots_qty CHECK (quantity >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE stock_movements (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  company_id BIGINT UNSIGNED NOT NULL,
  reference_number VARCHAR(40) NOT NULL,
  warehouse_id BIGINT UNSIGNED NOT NULL,
  item_id BIGINT UNSIGNED NOT NULL,
  movement_type ENUM('receipt', 'issue', 'transfer_in', 'transfer_out', 'adjustment', 'damage') NOT NULL,
  quantity DECIMAL(14, 3) NOT NULL,
  unit_cost DECIMAL(14, 2) NOT NULL DEFAULT 0,
  balance_after DECIMAL(14, 3) NOT NULL,
  lot_code VARCHAR(40) NULL,
  expiry_date DATE NULL,
  source_type VARCHAR(40) NULL,
  source_id BIGINT UNSIGNED NULL,
  notes VARCHAR(400) NULL,
  created_by BIGINT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_stock_movements_reference (reference_number),
  KEY idx_stock_movements_item (item_id, created_at),
  KEY idx_stock_movements_warehouse (warehouse_id, created_at),
  KEY idx_stock_movements_source (source_type, source_id),
  CONSTRAINT fk_stock_movements_company FOREIGN KEY (company_id) REFERENCES companies (id),
  CONSTRAINT fk_stock_movements_warehouse FOREIGN KEY (warehouse_id) REFERENCES warehouses (id),
  CONSTRAINT fk_stock_movements_item FOREIGN KEY (item_id) REFERENCES stock_items (id),
  CONSTRAINT fk_stock_movements_user FOREIGN KEY (created_by) REFERENCES users (id),
  CONSTRAINT chk_stock_movements_qty CHECK (quantity > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE purchase_requisitions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  company_id BIGINT UNSIGNED NOT NULL,
  reference_number VARCHAR(40) NOT NULL,
  requester_user_id BIGINT UNSIGNED NOT NULL,
  department_id BIGINT UNSIGNED NULL,
  branch_id BIGINT UNSIGNED NULL,
  purpose VARCHAR(400) NOT NULL,
  status ENUM('submitted', 'returned', 'approved', 'rejected', 'cancelled', 'ordered') NOT NULL DEFAULT 'submitted',
  approval_request_id BIGINT UNSIGNED NULL,
  total_amount DECIMAL(14, 2) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_purchase_requisitions_reference (reference_number),
  KEY idx_purchase_requisitions_status (status, created_at),
  CONSTRAINT fk_purchase_requisitions_company FOREIGN KEY (company_id) REFERENCES companies (id),
  CONSTRAINT fk_purchase_requisitions_user FOREIGN KEY (requester_user_id) REFERENCES users (id),
  CONSTRAINT fk_purchase_requisitions_department FOREIGN KEY (department_id) REFERENCES departments (id),
  CONSTRAINT fk_purchase_requisitions_branch FOREIGN KEY (branch_id) REFERENCES branches (id),
  CONSTRAINT fk_purchase_requisitions_approval FOREIGN KEY (approval_request_id) REFERENCES approval_requests (id),
  CONSTRAINT chk_purchase_requisitions_total CHECK (total_amount >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE purchase_requisition_lines (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  requisition_id BIGINT UNSIGNED NOT NULL,
  item_id BIGINT UNSIGNED NULL,
  description VARCHAR(200) NOT NULL,
  quantity DECIMAL(14, 3) NOT NULL,
  unit VARCHAR(20) NOT NULL,
  estimated_unit_cost DECIMAL(14, 2) NOT NULL,
  line_total DECIMAL(14, 2) NOT NULL,
  PRIMARY KEY (id),
  KEY idx_requisition_lines_requisition (requisition_id),
  CONSTRAINT fk_requisition_lines_requisition FOREIGN KEY (requisition_id) REFERENCES purchase_requisitions (id),
  CONSTRAINT fk_requisition_lines_item FOREIGN KEY (item_id) REFERENCES stock_items (id),
  CONSTRAINT chk_requisition_lines_qty CHECK (quantity > 0),
  CONSTRAINT chk_requisition_lines_cost CHECK (estimated_unit_cost >= 0 AND line_total >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE purchase_orders (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  company_id BIGINT UNSIGNED NOT NULL,
  reference_number VARCHAR(40) NOT NULL,
  requisition_id BIGINT UNSIGNED NOT NULL,
  supplier_id BIGINT UNSIGNED NOT NULL,
  status ENUM('issued', 'partial', 'received', 'cancelled') NOT NULL DEFAULT 'issued',
  total_amount DECIMAL(14, 2) NOT NULL,
  issued_by BIGINT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_purchase_orders_reference (reference_number),
  KEY idx_purchase_orders_requisition (requisition_id, status),
  CONSTRAINT fk_purchase_orders_company FOREIGN KEY (company_id) REFERENCES companies (id),
  CONSTRAINT fk_purchase_orders_requisition FOREIGN KEY (requisition_id) REFERENCES purchase_requisitions (id),
  CONSTRAINT fk_purchase_orders_supplier FOREIGN KEY (supplier_id) REFERENCES suppliers (id),
  CONSTRAINT fk_purchase_orders_user FOREIGN KEY (issued_by) REFERENCES users (id),
  CONSTRAINT chk_purchase_orders_total CHECK (total_amount >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE purchase_order_lines (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  order_id BIGINT UNSIGNED NOT NULL,
  requisition_line_id BIGINT UNSIGNED NOT NULL,
  item_id BIGINT UNSIGNED NULL,
  description VARCHAR(200) NOT NULL,
  quantity DECIMAL(14, 3) NOT NULL,
  unit_cost DECIMAL(14, 2) NOT NULL,
  received_quantity DECIMAL(14, 3) NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  KEY idx_order_lines_order (order_id),
  CONSTRAINT fk_order_lines_order FOREIGN KEY (order_id) REFERENCES purchase_orders (id),
  CONSTRAINT fk_order_lines_requisition_line FOREIGN KEY (requisition_line_id) REFERENCES purchase_requisition_lines (id),
  CONSTRAINT fk_order_lines_item FOREIGN KEY (item_id) REFERENCES stock_items (id),
  CONSTRAINT chk_order_lines_qty CHECK (quantity > 0 AND received_quantity >= 0 AND unit_cost >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE goods_received_notes (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  company_id BIGINT UNSIGNED NOT NULL,
  reference_number VARCHAR(40) NOT NULL,
  purchase_order_id BIGINT UNSIGNED NOT NULL,
  warehouse_id BIGINT UNSIGNED NOT NULL,
  received_by BIGINT UNSIGNED NOT NULL,
  received_on DATE NOT NULL,
  notes VARCHAR(400) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_goods_received_reference (reference_number),
  KEY idx_goods_received_order (purchase_order_id),
  CONSTRAINT fk_goods_received_company FOREIGN KEY (company_id) REFERENCES companies (id),
  CONSTRAINT fk_goods_received_order FOREIGN KEY (purchase_order_id) REFERENCES purchase_orders (id),
  CONSTRAINT fk_goods_received_warehouse FOREIGN KEY (warehouse_id) REFERENCES warehouses (id),
  CONSTRAINT fk_goods_received_user FOREIGN KEY (received_by) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE goods_received_lines (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  grn_id BIGINT UNSIGNED NOT NULL,
  order_line_id BIGINT UNSIGNED NOT NULL,
  quantity DECIMAL(14, 3) NOT NULL DEFAULT 0,
  damaged_quantity DECIMAL(14, 3) NOT NULL DEFAULT 0,
  unit_cost DECIMAL(14, 2) NOT NULL,
  lot_code VARCHAR(40) NULL,
  expiry_date DATE NULL,
  PRIMARY KEY (id),
  KEY idx_goods_received_lines_grn (grn_id),
  CONSTRAINT fk_goods_received_lines_grn FOREIGN KEY (grn_id) REFERENCES goods_received_notes (id),
  CONSTRAINT fk_goods_received_lines_order_line FOREIGN KEY (order_line_id) REFERENCES purchase_order_lines (id),
  CONSTRAINT chk_goods_received_lines_qty CHECK (quantity >= 0 AND damaged_quantity >= 0 AND unit_cost >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE supplier_invoices (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  company_id BIGINT UNSIGNED NOT NULL,
  reference_number VARCHAR(40) NOT NULL,
  supplier_id BIGINT UNSIGNED NOT NULL,
  purchase_order_id BIGINT UNSIGNED NULL,
  invoice_number VARCHAR(60) NOT NULL,
  invoice_date DATE NOT NULL,
  amount DECIMAL(14, 2) NOT NULL,
  notes VARCHAR(400) NULL,
  recorded_by BIGINT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_supplier_invoices_reference (reference_number),
  UNIQUE KEY uq_supplier_invoices_number (supplier_id, invoice_number),
  CONSTRAINT fk_supplier_invoices_company FOREIGN KEY (company_id) REFERENCES companies (id),
  CONSTRAINT fk_supplier_invoices_supplier FOREIGN KEY (supplier_id) REFERENCES suppliers (id),
  CONSTRAINT fk_supplier_invoices_order FOREIGN KEY (purchase_order_id) REFERENCES purchase_orders (id),
  CONSTRAINT fk_supplier_invoices_user FOREIGN KEY (recorded_by) REFERENCES users (id),
  CONSTRAINT chk_supplier_invoices_amount CHECK (amount > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO reference_sequences (sequence_key, next_value) VALUES
  ('supplier', 1),
  ('stock_movement', 1),
  ('purchase_requisition', 1),
  ('purchase_order', 1),
  ('goods_received', 1),
  ('supplier_invoice', 1)
ON DUPLICATE KEY UPDATE sequence_key = sequence_key;

INSERT INTO system_settings (setting_key, setting_value) VALUES
  ('supplier_prefix', JSON_QUOTE('BJG-SUP')),
  ('stock_movement_prefix', JSON_QUOTE('BJG-STK')),
  ('purchase_requisition_prefix', JSON_QUOTE('BJG-PRQ')),
  ('purchase_order_prefix', JSON_QUOTE('BJG-POR')),
  ('goods_received_prefix', JSON_QUOTE('BJG-GRN')),
  ('supplier_invoice_prefix', JSON_QUOTE('BJG-SIV'))
ON DUPLICATE KEY UPDATE setting_key = setting_key;
