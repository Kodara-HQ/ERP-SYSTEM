-- Forgotten passwords.
-- method 'email': a one-time link was emailed; only the SHA-256 of the link token is stored.
-- method 'administrator': no email could be sent, so the request waits for a system administrator.

CREATE TABLE password_reset_requests (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id BIGINT UNSIGNED NOT NULL,
  method ENUM('email', 'administrator') NOT NULL,
  token_hash CHAR(64) NULL,
  expires_at DATETIME(3) NULL,
  status ENUM('open', 'completed', 'expired', 'cancelled') NOT NULL DEFAULT 'open',
  ip_address VARCHAR(64) NULL,
  user_agent VARCHAR(255) NULL,
  handled_by BIGINT NULL,
  completed_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_password_reset_token (token_hash),
  KEY idx_password_reset_user (user_id, status),
  KEY idx_password_reset_status (status, created_at),
  CONSTRAINT fk_password_reset_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
