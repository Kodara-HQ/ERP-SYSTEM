-- Public website content managed inside BAJOGO ERP.
-- Publishing states: draft, pending_approval, approved, published.

CREATE TABLE website_settings (
  id SMALLINT NOT NULL,
  phone VARCHAR(40) NULL,
  email VARCHAR(180) NULL,
  address_line VARCHAR(255) NULL,
  city VARCHAR(120) NULL,
  country VARCHAR(120) NULL,
  map_url VARCHAR(500) NULL,
  facebook_url VARCHAR(255) NULL,
  twitter_url VARCHAR(255) NULL,
  linkedin_url VARCHAR(255) NULL,
  instagram_url VARCHAR(255) NULL,
  footer_text VARCHAR(800) NULL,
  seo_title VARCHAR(180) NULL,
  seo_description VARCHAR(320) NULL,
  staff_login_url VARCHAR(255) NULL,
  updated_by BIGINT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE website_media (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  asset_key VARCHAR(80) NULL,
  kind ENUM('image', 'document') NOT NULL DEFAULT 'image',
  file_name VARCHAR(200) NOT NULL,
  content_type VARCHAR(120) NOT NULL,
  byte_size INTEGER NOT NULL,
  alt_text VARCHAR(255) NULL,
  sha256 CHAR(64) NOT NULL,
  content BYTEA NOT NULL,
  uploaded_by BIGINT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_website_media_asset (asset_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE website_blocks (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  block_key VARCHAR(80) NOT NULL,
  title VARCHAR(200) NOT NULL,
  summary VARCHAR(1000) NULL,
  body TEXT NULL,
  content TEXT NULL,
  media_id BIGINT NULL,
  status ENUM('draft', 'pending_approval', 'approved', 'published') NOT NULL DEFAULT 'draft',
  sort_order INTEGER NOT NULL DEFAULT 0,
  meta_title VARCHAR(180) NULL,
  meta_description VARCHAR(320) NULL,
  created_by BIGINT NULL,
  updated_by BIGINT NULL,
  approved_by BIGINT NULL,
  published_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_website_blocks_key (block_key),
  KEY idx_website_blocks_status (status),
  CONSTRAINT fk_website_blocks_media FOREIGN KEY (media_id) REFERENCES website_media (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE website_items (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  item_type ENUM('division', 'strength', 'highlight', 'leader', 'service', 'value') NOT NULL,
  title VARCHAR(200) NOT NULL,
  summary VARCHAR(1000) NULL,
  body TEXT NULL,
  metric_value VARCHAR(80) NULL,
  metric_note VARCHAR(255) NULL,
  group_key VARCHAR(40) NULL,
  media_id BIGINT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  status ENUM('draft', 'pending_approval', 'approved', 'published') NOT NULL DEFAULT 'draft',
  created_by BIGINT NULL,
  updated_by BIGINT NULL,
  approved_by BIGINT NULL,
  published_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_website_items_type (item_type, status, sort_order),
  CONSTRAINT fk_website_items_media FOREIGN KEY (media_id) REFERENCES website_media (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE website_products (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  slug VARCHAR(80) NOT NULL,
  name VARCHAR(160) NOT NULL,
  summary VARCHAR(500) NOT NULL,
  description TEXT NOT NULL,
  category VARCHAR(40) NOT NULL,
  specifications TEXT NULL,
  grade_information TEXT NULL,
  packaging TEXT NULL,
  availability_status ENUM('unspecified', 'available', 'limited', 'unavailable') NOT NULL DEFAULT 'unspecified',
  featured SMALLINT NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  status ENUM('draft', 'pending_approval', 'approved', 'published') NOT NULL DEFAULT 'draft',
  meta_title VARCHAR(180) NULL,
  meta_description VARCHAR(320) NULL,
  created_by BIGINT NULL,
  updated_by BIGINT NULL,
  approved_by BIGINT NULL,
  published_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_website_products_slug (slug),
  KEY idx_website_products_status (status, featured, sort_order)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE website_product_images (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  product_id BIGINT NOT NULL,
  media_id BIGINT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_primary SMALLINT NOT NULL DEFAULT 0,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_website_product_image (product_id, media_id),
  CONSTRAINT fk_website_product_images_product FOREIGN KEY (product_id) REFERENCES website_products (id) ON DELETE CASCADE,
  CONSTRAINT fk_website_product_images_media FOREIGN KEY (media_id) REFERENCES website_media (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE website_articles (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  slug VARCHAR(80) NOT NULL,
  title VARCHAR(200) NOT NULL,
  summary VARCHAR(500) NOT NULL,
  body TEXT NOT NULL,
  category VARCHAR(40) NOT NULL DEFAULT 'company',
  featured SMALLINT NOT NULL DEFAULT 0,
  published_on DATE NULL,
  hero_media_id BIGINT NULL,
  status ENUM('draft', 'pending_approval', 'approved', 'published') NOT NULL DEFAULT 'draft',
  meta_title VARCHAR(180) NULL,
  meta_description VARCHAR(320) NULL,
  created_by BIGINT NULL,
  updated_by BIGINT NULL,
  approved_by BIGINT NULL,
  published_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_website_articles_slug (slug),
  KEY idx_website_articles_status (status, published_on),
  CONSTRAINT fk_website_articles_media FOREIGN KEY (hero_media_id) REFERENCES website_media (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE website_gallery (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  media_id BIGINT NOT NULL,
  category ENUM('cashew', 'soybean', 'shea', 'cassava', 'cocoa', 'ginger', 'warehouses', 'haulage', 'gold', 'activities') NOT NULL,
  caption VARCHAR(300) NULL,
  featured_on_home SMALLINT NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  status ENUM('draft', 'pending_approval', 'approved', 'published') NOT NULL DEFAULT 'draft',
  created_by BIGINT NULL,
  updated_by BIGINT NULL,
  approved_by BIGINT NULL,
  published_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_website_gallery_status (status, category, sort_order),
  CONSTRAINT fk_website_gallery_media FOREIGN KEY (media_id) REFERENCES website_media (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE website_vacancies (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  slug VARCHAR(80) NOT NULL,
  title VARCHAR(160) NOT NULL,
  location_label VARCHAR(160) NULL,
  summary VARCHAR(500) NOT NULL,
  description TEXT NOT NULL,
  requirements TEXT NULL,
  applications_enabled SMALLINT NOT NULL DEFAULT 1,
  status ENUM('draft', 'pending_approval', 'approved', 'published') NOT NULL DEFAULT 'draft',
  meta_title VARCHAR(180) NULL,
  meta_description VARCHAR(320) NULL,
  created_by BIGINT NULL,
  updated_by BIGINT NULL,
  approved_by BIGINT NULL,
  published_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_website_vacancies_slug (slug),
  KEY idx_website_vacancies_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE website_applications (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  vacancy_id BIGINT NOT NULL,
  full_name VARCHAR(120) NOT NULL,
  email VARCHAR(180) NOT NULL,
  phone VARCHAR(40) NULL,
  message VARCHAR(4000) NOT NULL,
  cv_media_id BIGINT NULL,
  status ENUM('new', 'reviewed') NOT NULL DEFAULT 'new',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_website_applications_vacancy (vacancy_id, status),
  CONSTRAINT fk_website_applications_vacancy FOREIGN KEY (vacancy_id) REFERENCES website_vacancies (id),
  CONSTRAINT fk_website_applications_cv FOREIGN KEY (cv_media_id) REFERENCES website_media (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE website_enquiries (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  full_name VARCHAR(120) NOT NULL,
  company_name VARCHAR(160) NULL,
  email VARCHAR(180) NOT NULL,
  telephone VARCHAR(40) NULL,
  category ENUM('agricultural', 'gold', 'haulage', 'general') NOT NULL,
  product_or_service VARCHAR(160) NULL,
  subject VARCHAR(160) NOT NULL,
  message VARCHAR(4000) NOT NULL,
  status ENUM('new', 'read', 'closed') NOT NULL DEFAULT 'new',
  handled_by BIGINT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_website_enquiries_status (status, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO permissions (code, module, action, description, sensitivity)
SELECT 'website.view', 'website', 'view', 'View website content, including drafts', 'standard'
WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE code = 'website.view');

INSERT INTO permissions (code, module, action, description, sensitivity)
SELECT 'website.edit', 'website', 'edit', 'Draft and edit website content and upload images', 'standard'
WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE code = 'website.edit');

INSERT INTO permissions (code, module, action, description, sensitivity)
SELECT 'website.publish', 'website', 'approve', 'Approve, publish, and unpublish website content', 'standard'
WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE code = 'website.publish');

INSERT INTO permissions (code, module, action, description, sensitivity)
SELECT 'website.enquiries', 'website', 'view', 'Read and update customer enquiries from the website', 'standard'
WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE code = 'website.enquiries');

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON (
  (r.code = 'CEO' AND p.code IN ('website.view', 'website.edit', 'website.publish', 'website.enquiries'))
  OR (r.code = 'IT_MARKETING_MANAGER' AND p.code IN ('website.view', 'website.edit', 'website.publish', 'website.enquiries'))
  OR (r.code = 'MARKETING_OFFICER' AND p.code IN ('website.view', 'website.edit', 'website.enquiries'))
)
WHERE NOT EXISTS (
  SELECT 1 FROM role_permissions rp WHERE rp.role_id = r.id AND rp.permission_id = p.id
);

INSERT INTO department_workspaces (department_id, workspace_code)
SELECT d.id, 'website'
FROM departments d
WHERE d.code IN ('ITM', 'ITM-MKT')
AND NOT EXISTS (
  SELECT 1 FROM department_workspaces w WHERE w.department_id = d.id AND w.workspace_code = 'website'
);
