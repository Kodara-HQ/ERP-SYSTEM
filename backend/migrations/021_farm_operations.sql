-- Farm Operations for the Operations Manager.
-- Extends existing structures: stock (stock_items, warehouses, stock_movements), the approval engine,
-- supporting_documents, notifications, and audit_logs. The farm-plot, equipment, and haulage registers
-- become proper tables with foreign keys; any entries already in those registers are copied across.

CREATE TABLE farms (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  company_id BIGINT UNSIGNED NOT NULL,
  code VARCHAR(30) NOT NULL,
  name VARCHAR(160) NOT NULL,
  location VARCHAR(200) NOT NULL,
  region VARCHAR(120) NULL,
  gps_coordinates VARCHAR(80) NULL,
  total_area_ha DECIMAL(12, 2) NOT NULL DEFAULT 0,
  cultivated_area_ha DECIMAL(12, 2) NOT NULL DEFAULT 0,
  ownership ENUM('owned', 'leased', 'partner') NOT NULL DEFAULT 'owned',
  status ENUM('active', 'fallow', 'inactive') NOT NULL DEFAULT 'active',
  department_id BIGINT UNSIGNED NULL,
  supervisor_employee_id BIGINT UNSIGNED NULL,
  warehouse_id BIGINT UNSIGNED NULL,
  notes VARCHAR(1000) NULL,
  created_by BIGINT UNSIGNED NOT NULL,
  updated_by BIGINT UNSIGNED NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_farms_code (company_id, code),
  KEY idx_farms_status (status),
  CONSTRAINT fk_farms_company FOREIGN KEY (company_id) REFERENCES companies (id),
  CONSTRAINT fk_farms_department FOREIGN KEY (department_id) REFERENCES departments (id),
  CONSTRAINT fk_farms_supervisor FOREIGN KEY (supervisor_employee_id) REFERENCES employees (id),
  CONSTRAINT fk_farms_warehouse FOREIGN KEY (warehouse_id) REFERENCES warehouses (id),
  CONSTRAINT fk_farms_creator FOREIGN KEY (created_by) REFERENCES users (id),
  CONSTRAINT fk_farms_editor FOREIGN KEY (updated_by) REFERENCES users (id),
  CONSTRAINT chk_farms_area CHECK (total_area_ha >= 0 AND cultivated_area_ha >= 0 AND cultivated_area_ha <= total_area_ha)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE farm_team_members (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  farm_id BIGINT UNSIGNED NOT NULL,
  employee_id BIGINT UNSIGNED NOT NULL,
  team_role ENUM('supervisor', 'worker', 'operator') NOT NULL,
  responsibilities VARCHAR(500) NULL,
  start_date DATE NOT NULL,
  end_date DATE NULL,
  created_by BIGINT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_farm_team_farm (farm_id, end_date),
  KEY idx_farm_team_employee (employee_id, end_date),
  CONSTRAINT fk_farm_team_farm FOREIGN KEY (farm_id) REFERENCES farms (id),
  CONSTRAINT fk_farm_team_employee FOREIGN KEY (employee_id) REFERENCES employees (id),
  CONSTRAINT fk_farm_team_user FOREIGN KEY (created_by) REFERENCES users (id),
  CONSTRAINT chk_farm_team_dates CHECK (end_date IS NULL OR end_date >= start_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE farm_crop_cycles (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  company_id BIGINT UNSIGNED NOT NULL,
  reference_number VARCHAR(40) NOT NULL,
  farm_id BIGINT UNSIGNED NOT NULL,
  crop VARCHAR(80) NOT NULL,
  variety VARCHAR(80) NULL,
  season VARCHAR(20) NOT NULL,
  area_ha DECIMAL(12, 2) NOT NULL,
  planting_date DATE NULL,
  expected_harvest_date DATE NULL,
  stage ENUM('planned', 'land_preparation', 'planting', 'vegetative', 'flowering', 'fruiting', 'harvesting', 'completed') NOT NULL DEFAULT 'planned',
  expected_yield_kg DECIMAL(14, 2) NULL,
  status ENUM('active', 'completed', 'abandoned') NOT NULL DEFAULT 'active',
  notes VARCHAR(1000) NULL,
  created_by BIGINT UNSIGNED NOT NULL,
  updated_by BIGINT UNSIGNED NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_farm_crop_cycles_reference (reference_number),
  KEY idx_farm_crop_cycles_farm (farm_id, status),
  CONSTRAINT fk_farm_crop_cycles_company FOREIGN KEY (company_id) REFERENCES companies (id),
  CONSTRAINT fk_farm_crop_cycles_farm FOREIGN KEY (farm_id) REFERENCES farms (id),
  CONSTRAINT fk_farm_crop_cycles_creator FOREIGN KEY (created_by) REFERENCES users (id),
  CONSTRAINT fk_farm_crop_cycles_editor FOREIGN KEY (updated_by) REFERENCES users (id),
  CONSTRAINT chk_farm_crop_cycles_area CHECK (area_ha > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE farm_activities (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  company_id BIGINT UNSIGNED NOT NULL,
  reference_number VARCHAR(40) NOT NULL,
  farm_id BIGINT UNSIGNED NOT NULL,
  crop_cycle_id BIGINT UNSIGNED NULL,
  activity_type ENUM('land_preparation', 'planting', 'fertilisation', 'irrigation', 'weeding', 'pest_control', 'pruning', 'harvesting', 'equipment_servicing', 'inspection', 'other') NOT NULL,
  title VARCHAR(200) NOT NULL,
  scheduled_date DATE NOT NULL,
  due_date DATE NOT NULL,
  assigned_user_id BIGINT UNSIGNED NULL,
  status ENUM('planned', 'in_progress', 'completed', 'cancelled') NOT NULL DEFAULT 'planned',
  completed_on DATE NULL,
  notes VARCHAR(1000) NULL,
  created_by BIGINT UNSIGNED NOT NULL,
  updated_by BIGINT UNSIGNED NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_farm_activities_reference (reference_number),
  KEY idx_farm_activities_schedule (farm_id, scheduled_date),
  KEY idx_farm_activities_status (status, due_date),
  CONSTRAINT fk_farm_activities_company FOREIGN KEY (company_id) REFERENCES companies (id),
  CONSTRAINT fk_farm_activities_farm FOREIGN KEY (farm_id) REFERENCES farms (id),
  CONSTRAINT fk_farm_activities_cycle FOREIGN KEY (crop_cycle_id) REFERENCES farm_crop_cycles (id),
  CONSTRAINT fk_farm_activities_assignee FOREIGN KEY (assigned_user_id) REFERENCES users (id),
  CONSTRAINT fk_farm_activities_creator FOREIGN KEY (created_by) REFERENCES users (id),
  CONSTRAINT fk_farm_activities_editor FOREIGN KEY (updated_by) REFERENCES users (id),
  CONSTRAINT chk_farm_activities_dates CHECK (due_date >= scheduled_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE farm_daily_reports (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  company_id BIGINT UNSIGNED NOT NULL,
  reference_number VARCHAR(40) NOT NULL,
  farm_id BIGINT UNSIGNED NOT NULL,
  activity_id BIGINT UNSIGNED NULL,
  activity_date DATE NOT NULL,
  activity_type ENUM('land_preparation', 'planting', 'fertilisation', 'irrigation', 'weeding', 'pest_control', 'pruning', 'harvesting', 'equipment_servicing', 'inspection', 'other') NOT NULL,
  work_performed VARCHAR(2000) NOT NULL,
  workers_count INT UNSIGNED NOT NULL DEFAULT 0,
  worker_names VARCHAR(1000) NULL,
  resources_used VARCHAR(1000) NULL,
  work_completed VARCHAR(1000) NULL,
  area_covered_ha DECIMAL(12, 2) NULL,
  challenges VARCHAR(1000) NULL,
  supervisor_remarks VARCHAR(1000) NULL,
  status ENUM('submitted', 'acknowledged', 'returned') NOT NULL DEFAULT 'submitted',
  submitted_by BIGINT UNSIGNED NOT NULL,
  submitted_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  reviewed_by BIGINT UNSIGNED NULL,
  reviewed_at DATETIME(3) NULL,
  review_remarks VARCHAR(1000) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_farm_daily_reports_reference (reference_number),
  KEY idx_farm_daily_reports_farm (farm_id, activity_date),
  KEY idx_farm_daily_reports_status (status),
  CONSTRAINT fk_farm_daily_reports_company FOREIGN KEY (company_id) REFERENCES companies (id),
  CONSTRAINT fk_farm_daily_reports_farm FOREIGN KEY (farm_id) REFERENCES farms (id),
  CONSTRAINT fk_farm_daily_reports_activity FOREIGN KEY (activity_id) REFERENCES farm_activities (id),
  CONSTRAINT fk_farm_daily_reports_submitter FOREIGN KEY (submitted_by) REFERENCES users (id),
  CONSTRAINT fk_farm_daily_reports_reviewer FOREIGN KEY (reviewed_by) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE farm_inspections (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  company_id BIGINT UNSIGNED NOT NULL,
  reference_number VARCHAR(40) NOT NULL,
  farm_id BIGINT UNSIGNED NOT NULL,
  crop_cycle_id BIGINT UNSIGNED NULL,
  inspection_date DATE NOT NULL,
  inspection_type ENUM('routine', 'crop_health', 'pest', 'compliance', 'harvest_readiness', 'equipment', 'safety') NOT NULL,
  rating SMALLINT NULL,
  findings VARCHAR(2000) NOT NULL,
  recommendations VARCHAR(2000) NULL,
  follow_up_date DATE NULL,
  status ENUM('open', 'follow_up', 'closed') NOT NULL DEFAULT 'open',
  inspector_user_id BIGINT UNSIGNED NOT NULL,
  closed_by BIGINT UNSIGNED NULL,
  closed_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_farm_inspections_reference (reference_number),
  KEY idx_farm_inspections_farm (farm_id, inspection_date),
  CONSTRAINT fk_farm_inspections_company FOREIGN KEY (company_id) REFERENCES companies (id),
  CONSTRAINT fk_farm_inspections_farm FOREIGN KEY (farm_id) REFERENCES farms (id),
  CONSTRAINT fk_farm_inspections_cycle FOREIGN KEY (crop_cycle_id) REFERENCES farm_crop_cycles (id),
  CONSTRAINT fk_farm_inspections_inspector FOREIGN KEY (inspector_user_id) REFERENCES users (id),
  CONSTRAINT fk_farm_inspections_closer FOREIGN KEY (closed_by) REFERENCES users (id),
  CONSTRAINT chk_farm_inspections_rating CHECK (rating IS NULL OR rating BETWEEN 1 AND 5)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE farm_production_targets (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  company_id BIGINT UNSIGNED NOT NULL,
  farm_id BIGINT UNSIGNED NOT NULL,
  crop VARCHAR(80) NOT NULL,
  season VARCHAR(20) NOT NULL,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  target_kg DECIMAL(14, 2) NOT NULL,
  notes VARCHAR(500) NULL,
  created_by BIGINT UNSIGNED NOT NULL,
  updated_by BIGINT UNSIGNED NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_farm_targets (farm_id, crop, season),
  CONSTRAINT fk_farm_targets_company FOREIGN KEY (company_id) REFERENCES companies (id),
  CONSTRAINT fk_farm_targets_farm FOREIGN KEY (farm_id) REFERENCES farms (id),
  CONSTRAINT fk_farm_targets_creator FOREIGN KEY (created_by) REFERENCES users (id),
  CONSTRAINT fk_farm_targets_editor FOREIGN KEY (updated_by) REFERENCES users (id),
  CONSTRAINT chk_farm_targets_amount CHECK (target_kg > 0 AND period_end >= period_start)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE farm_harvests (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  company_id BIGINT UNSIGNED NOT NULL,
  reference_number VARCHAR(40) NOT NULL,
  farm_id BIGINT UNSIGNED NOT NULL,
  crop_cycle_id BIGINT UNSIGNED NULL,
  crop VARCHAR(80) NOT NULL,
  season VARCHAR(20) NOT NULL,
  harvest_date DATE NOT NULL,
  expected_kg DECIMAL(14, 2) NULL,
  quantity_kg DECIMAL(14, 2) NOT NULL,
  loss_kg DECIMAL(14, 2) NOT NULL DEFAULT 0,
  grade VARCHAR(40) NULL,
  moisture_percent DECIMAL(5, 2) NULL,
  quality_notes VARCHAR(1000) NULL,
  stock_item_id BIGINT UNSIGNED NULL,
  warehouse_id BIGINT UNSIGNED NULL,
  status ENUM('recorded', 'verified', 'rejected') NOT NULL DEFAULT 'recorded',
  recorded_by BIGINT UNSIGNED NOT NULL,
  verified_by BIGINT UNSIGNED NULL,
  verified_at DATETIME(3) NULL,
  rejection_reason VARCHAR(500) NULL,
  stock_movement_id BIGINT UNSIGNED NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_farm_harvests_reference (reference_number),
  UNIQUE KEY uq_farm_harvests_movement (stock_movement_id),
  KEY idx_farm_harvests_farm (farm_id, harvest_date),
  CONSTRAINT fk_farm_harvests_company FOREIGN KEY (company_id) REFERENCES companies (id),
  CONSTRAINT fk_farm_harvests_farm FOREIGN KEY (farm_id) REFERENCES farms (id),
  CONSTRAINT fk_farm_harvests_cycle FOREIGN KEY (crop_cycle_id) REFERENCES farm_crop_cycles (id),
  CONSTRAINT fk_farm_harvests_item FOREIGN KEY (stock_item_id) REFERENCES stock_items (id),
  CONSTRAINT fk_farm_harvests_warehouse FOREIGN KEY (warehouse_id) REFERENCES warehouses (id),
  CONSTRAINT fk_farm_harvests_recorder FOREIGN KEY (recorded_by) REFERENCES users (id),
  CONSTRAINT fk_farm_harvests_verifier FOREIGN KEY (verified_by) REFERENCES users (id),
  CONSTRAINT fk_farm_harvests_movement FOREIGN KEY (stock_movement_id) REFERENCES stock_movements (id),
  CONSTRAINT chk_farm_harvests_quantity CHECK (quantity_kg > 0 AND loss_kg >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE farm_resource_requests (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  company_id BIGINT UNSIGNED NOT NULL,
  reference_number VARCHAR(40) NOT NULL,
  farm_id BIGINT UNSIGNED NOT NULL,
  category ENUM('seeds', 'fertiliser', 'pesticide', 'herbicide', 'irrigation', 'equipment', 'fuel', 'labour', 'other') NOT NULL,
  stock_item_id BIGINT UNSIGNED NULL,
  description VARCHAR(300) NOT NULL,
  quantity DECIMAL(14, 3) NOT NULL,
  unit VARCHAR(20) NOT NULL,
  estimated_cost DECIMAL(14, 2) NULL,
  justification VARCHAR(1000) NOT NULL,
  needed_by DATE NULL,
  status ENUM('submitted', 'approved', 'rejected', 'returned', 'fulfilled', 'cancelled') NOT NULL DEFAULT 'submitted',
  approval_request_id BIGINT UNSIGNED NULL,
  requested_by BIGINT UNSIGNED NOT NULL,
  fulfilled_quantity DECIMAL(14, 3) NULL,
  fulfilled_by BIGINT UNSIGNED NULL,
  fulfilled_at DATETIME(3) NULL,
  warehouse_id BIGINT UNSIGNED NULL,
  stock_movement_id BIGINT UNSIGNED NULL,
  remarks VARCHAR(1000) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_farm_resource_requests_reference (reference_number),
  UNIQUE KEY uq_farm_resource_requests_movement (stock_movement_id),
  KEY idx_farm_resource_requests_status (status),
  CONSTRAINT fk_farm_requests_company FOREIGN KEY (company_id) REFERENCES companies (id),
  CONSTRAINT fk_farm_requests_farm FOREIGN KEY (farm_id) REFERENCES farms (id),
  CONSTRAINT fk_farm_requests_item FOREIGN KEY (stock_item_id) REFERENCES stock_items (id),
  CONSTRAINT fk_farm_requests_approval FOREIGN KEY (approval_request_id) REFERENCES approval_requests (id),
  CONSTRAINT fk_farm_requests_requester FOREIGN KEY (requested_by) REFERENCES users (id),
  CONSTRAINT fk_farm_requests_fulfiller FOREIGN KEY (fulfilled_by) REFERENCES users (id),
  CONSTRAINT fk_farm_requests_warehouse FOREIGN KEY (warehouse_id) REFERENCES warehouses (id),
  CONSTRAINT fk_farm_requests_movement FOREIGN KEY (stock_movement_id) REFERENCES stock_movements (id),
  CONSTRAINT chk_farm_requests_quantity CHECK (quantity > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE farm_incidents (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  company_id BIGINT UNSIGNED NOT NULL,
  reference_number VARCHAR(40) NOT NULL,
  farm_id BIGINT UNSIGNED NOT NULL,
  category ENUM('crop_disease', 'pest_infestation', 'equipment_breakdown', 'labour_shortage', 'weather', 'damaged_produce', 'resource_shortage', 'safety', 'other') NOT NULL,
  title VARCHAR(200) NOT NULL,
  description VARCHAR(2000) NOT NULL,
  priority ENUM('low', 'medium', 'high', 'critical') NOT NULL,
  occurred_on DATE NOT NULL,
  status ENUM('reported', 'investigating', 'in_progress', 'resolved', 'closed') NOT NULL DEFAULT 'reported',
  reported_by BIGINT UNSIGNED NOT NULL,
  assigned_to_user_id BIGINT UNSIGNED NULL,
  resolution_remarks VARCHAR(2000) NULL,
  resolved_by BIGINT UNSIGNED NULL,
  resolved_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_farm_incidents_reference (reference_number),
  KEY idx_farm_incidents_status (status, priority),
  CONSTRAINT fk_farm_incidents_company FOREIGN KEY (company_id) REFERENCES companies (id),
  CONSTRAINT fk_farm_incidents_farm FOREIGN KEY (farm_id) REFERENCES farms (id),
  CONSTRAINT fk_farm_incidents_reporter FOREIGN KEY (reported_by) REFERENCES users (id),
  CONSTRAINT fk_farm_incidents_assignee FOREIGN KEY (assigned_to_user_id) REFERENCES users (id),
  CONSTRAINT fk_farm_incidents_resolver FOREIGN KEY (resolved_by) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE equipment_assets (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  company_id BIGINT UNSIGNED NOT NULL,
  asset_code VARCHAR(40) NOT NULL,
  name VARCHAR(160) NOT NULL,
  asset_type ENUM('truck', 'vehicle', 'tractor', 'harvester', 'irrigation_pump', 'sprayer', 'processing_machine', 'generator', 'tool', 'other') NOT NULL,
  registration_number VARCHAR(60) NULL,
  equipment_condition ENUM('good', 'fair', 'poor', 'out_of_service') NOT NULL DEFAULT 'good',
  status ENUM('available', 'in_use', 'maintenance', 'retired') NOT NULL DEFAULT 'available',
  farm_id BIGINT UNSIGNED NULL,
  last_service_on DATE NULL,
  next_service_on DATE NULL,
  usage_hours DECIMAL(12, 1) NOT NULL DEFAULT 0,
  notes VARCHAR(1000) NULL,
  created_by BIGINT UNSIGNED NOT NULL,
  updated_by BIGINT UNSIGNED NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_equipment_assets_code (company_id, asset_code),
  KEY idx_equipment_assets_status (status, next_service_on),
  CONSTRAINT fk_equipment_assets_company FOREIGN KEY (company_id) REFERENCES companies (id),
  CONSTRAINT fk_equipment_assets_farm FOREIGN KEY (farm_id) REFERENCES farms (id),
  CONSTRAINT fk_equipment_assets_creator FOREIGN KEY (created_by) REFERENCES users (id),
  CONSTRAINT fk_equipment_assets_editor FOREIGN KEY (updated_by) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE equipment_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  equipment_id BIGINT UNSIGNED NOT NULL,
  event_type ENUM('allocation', 'release', 'maintenance', 'repair', 'usage', 'condition') NOT NULL,
  event_date DATE NOT NULL,
  farm_id BIGINT UNSIGNED NULL,
  description VARCHAR(1000) NOT NULL,
  cost DECIMAL(14, 2) NULL,
  hours DECIMAL(12, 1) NULL,
  recorded_by BIGINT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_equipment_events_equipment (equipment_id, event_date),
  CONSTRAINT fk_equipment_events_equipment FOREIGN KEY (equipment_id) REFERENCES equipment_assets (id),
  CONSTRAINT fk_equipment_events_farm FOREIGN KEY (farm_id) REFERENCES farms (id),
  CONSTRAINT fk_equipment_events_user FOREIGN KEY (recorded_by) REFERENCES users (id),
  CONSTRAINT chk_equipment_events_values CHECK ((cost IS NULL OR cost >= 0) AND (hours IS NULL OR hours >= 0))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE haulage_trips (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  company_id BIGINT UNSIGNED NOT NULL,
  reference_number VARCHAR(40) NOT NULL,
  trip_date DATE NOT NULL,
  vehicle_id BIGINT UNSIGNED NULL,
  vehicle_label VARCHAR(120) NULL,
  driver_name VARCHAR(160) NULL,
  origin VARCHAR(200) NOT NULL,
  destination VARCHAR(200) NOT NULL,
  cargo VARCHAR(200) NULL,
  quantity_kg DECIMAL(14, 2) NULL,
  distance_km DECIMAL(10, 1) NULL,
  fuel_litres DECIMAL(10, 1) NULL,
  status ENUM('planned', 'in_transit', 'delivered', 'cancelled') NOT NULL DEFAULT 'planned',
  departed_at DATETIME(3) NULL,
  delivered_at DATETIME(3) NULL,
  notes VARCHAR(1000) NULL,
  created_by BIGINT UNSIGNED NOT NULL,
  updated_by BIGINT UNSIGNED NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_haulage_trips_reference (reference_number),
  KEY idx_haulage_trips_status (status, trip_date),
  CONSTRAINT fk_haulage_trips_company FOREIGN KEY (company_id) REFERENCES companies (id),
  CONSTRAINT fk_haulage_trips_vehicle FOREIGN KEY (vehicle_id) REFERENCES equipment_assets (id),
  CONSTRAINT fk_haulage_trips_creator FOREIGN KEY (created_by) REFERENCES users (id),
  CONSTRAINT fk_haulage_trips_editor FOREIGN KEY (updated_by) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE farm_dispatches (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  company_id BIGINT UNSIGNED NOT NULL,
  reference_number VARCHAR(40) NOT NULL,
  farm_id BIGINT UNSIGNED NULL,
  stock_item_id BIGINT UNSIGNED NOT NULL,
  warehouse_id BIGINT UNSIGNED NOT NULL,
  quantity DECIMAL(14, 3) NOT NULL,
  collection_location VARCHAR(200) NOT NULL,
  destination VARCHAR(200) NOT NULL,
  purpose ENUM('sale', 'processing', 'transfer', 'other') NOT NULL,
  required_by DATE NULL,
  status ENUM('requested', 'scheduled', 'in_transit', 'delivered', 'cancelled') NOT NULL DEFAULT 'requested',
  requested_by BIGINT UNSIGNED NOT NULL,
  authorised_by BIGINT UNSIGNED NULL,
  authorised_at DATETIME(3) NULL,
  haulage_trip_id BIGINT UNSIGNED NULL,
  stock_movement_id BIGINT UNSIGNED NULL,
  dispatched_at DATETIME(3) NULL,
  delivered_at DATETIME(3) NULL,
  remarks VARCHAR(1000) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_farm_dispatches_reference (reference_number),
  UNIQUE KEY uq_farm_dispatches_movement (stock_movement_id),
  KEY idx_farm_dispatches_status (status),
  CONSTRAINT fk_farm_dispatches_company FOREIGN KEY (company_id) REFERENCES companies (id),
  CONSTRAINT fk_farm_dispatches_farm FOREIGN KEY (farm_id) REFERENCES farms (id),
  CONSTRAINT fk_farm_dispatches_item FOREIGN KEY (stock_item_id) REFERENCES stock_items (id),
  CONSTRAINT fk_farm_dispatches_warehouse FOREIGN KEY (warehouse_id) REFERENCES warehouses (id),
  CONSTRAINT fk_farm_dispatches_requester FOREIGN KEY (requested_by) REFERENCES users (id),
  CONSTRAINT fk_farm_dispatches_authoriser FOREIGN KEY (authorised_by) REFERENCES users (id),
  CONSTRAINT fk_farm_dispatches_trip FOREIGN KEY (haulage_trip_id) REFERENCES haulage_trips (id),
  CONSTRAINT fk_farm_dispatches_movement FOREIGN KEY (stock_movement_id) REFERENCES stock_movements (id),
  CONSTRAINT chk_farm_dispatches_quantity CHECK (quantity > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE stock_movements
  ADD COLUMN farm_id BIGINT NULL,
  ADD CONSTRAINT fk_stock_movements_farm FOREIGN KEY (farm_id) REFERENCES farms (id);

CREATE INDEX idx_stock_movements_farm ON stock_movements (farm_id, created_at);

-- A farm harvest can be received into stock only once. (Issues may span several lots, so they are
-- guarded by the dispatch and request rows instead.)
CREATE UNIQUE INDEX uq_stock_movements_farm_receipt ON stock_movements (source_type, source_id) WHERE source_type LIKE 'farm_%' AND movement_type = 'receipt';

-- Copy any existing register entries into the new tables. The registers are retired from the screens.
INSERT INTO farms (company_id, code, name, location, total_area_ha, cultivated_area_ha, status, department_id, notes, created_by, created_at)
SELECT e.company_id, e.reference_number, e.title, COALESCE(NULLIF(e.details->>'location', ''), 'Not recorded'),
       COALESCE(e.quantity, 0), COALESCE(e.quantity, 0),
       CASE WHEN e.status IN ('active', 'fallow', 'inactive') THEN e.status ELSE 'active' END,
       e.department_id, NULLIF(CONCAT_WS(' ', 'Crop: ' || NULLIF(e.details->>'crop', ''), 'Trees: ' || NULLIF(e.details->>'treeCount', '')), ''),
       e.created_by, e.created_at
FROM department_register_entries e WHERE e.register_code = 'farm_plots';

INSERT INTO equipment_assets (company_id, asset_code, name, asset_type, registration_number, status, last_service_on, next_service_on, notes, created_by, created_at)
SELECT e.company_id, e.reference_number, e.title,
       CASE WHEN e.details->>'assetType' IN ('truck', 'vehicle', 'tractor', 'processing_machine', 'generator', 'tool') THEN e.details->>'assetType' ELSE 'other' END,
       NULLIF(e.details->>'registrationNumber', ''),
       CASE WHEN e.status IN ('available', 'in_use', 'maintenance', 'retired') THEN e.status ELSE 'available' END,
       e.entry_date, e.due_on, NULLIF(e.details->>'notes', ''), e.created_by, e.created_at
FROM department_register_entries e WHERE e.register_code = 'equipment';

INSERT INTO haulage_trips (company_id, reference_number, trip_date, vehicle_label, driver_name, origin, destination, cargo, quantity_kg, distance_km, fuel_litres, status, created_by, created_at)
SELECT e.company_id, e.reference_number, COALESCE(e.entry_date, CAST(e.created_at AS DATE)), NULLIF(e.details->>'vehicle', ''), NULLIF(e.details->>'driver', ''),
       e.title, e.title, NULLIF(e.details->>'cargo', ''), e.quantity,
       CAST(NULLIF(e.details->>'distanceKm', '') AS NUMERIC), CAST(NULLIF(e.details->>'fuelLitres', '') AS NUMERIC),
       CASE WHEN e.status IN ('planned', 'in_transit', 'delivered', 'cancelled') THEN e.status ELSE 'planned' END,
       e.created_by, e.created_at
FROM department_register_entries e WHERE e.register_code = 'haulage_trips';

-- Every manager is an employee, starting with the CEO. The CEO position belongs to the Executive Office
-- so HR can register the CEO like any other employee.
INSERT INTO departments (company_id, code, name, status)
SELECT c.id, 'EXEC', 'Executive Office', 'active' FROM companies c
WHERE NOT EXISTS (SELECT 1 FROM departments d WHERE d.company_id = c.id AND d.code = 'EXEC');

UPDATE positions SET department_id = (SELECT d.id FROM departments d WHERE d.code = 'EXEC' AND d.company_id = positions.company_id)
WHERE code = 'CEO' AND department_id IS NULL;

INSERT INTO department_workspaces (department_id, workspace_code)
SELECT d.id, 'operations' FROM departments d
WHERE d.code IN ('OPS-HAUL', 'OPS-LOAD') AND NOT EXISTS (SELECT 1 FROM department_workspaces w WHERE w.department_id = d.id AND w.workspace_code = 'operations');
