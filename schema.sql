-- Schema for RutaSmart secure backend (MySQL)
CREATE DATABASE IF NOT EXISTS myapp_db CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;
USE myapp_db;

-- roles
CREATE TABLE IF NOT EXISTS roles (
  id TINYINT UNSIGNED NOT NULL AUTO_INCREMENT,
  name VARCHAR(50) NOT NULL,
  description VARCHAR(255),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY ux_roles_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- users (admins / regular users)
CREATE TABLE IF NOT EXISTS users (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  uuid CHAR(36) NOT NULL,
  username VARCHAR(50) NOT NULL,
  email VARCHAR(255) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role_id TINYINT UNSIGNED NOT NULL DEFAULT 2,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  failed_attempts SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  lockout_until DATETIME NULL,
  last_login DATETIME NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY ux_users_uuid (uuid),
  UNIQUE KEY ux_users_username (username),
  UNIQUE KEY ux_users_email (email),
  KEY idx_users_role (role_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- drivers table (separate from users)
CREATE TABLE IF NOT EXISTS drivers (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  username VARCHAR(50) NOT NULL,
  display_name VARCHAR(150) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY ux_drivers_username (username)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- workers table
CREATE TABLE IF NOT EXISTS workers (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  name VARCHAR(255) NOT NULL,
  address VARCHAR(500) NOT NULL,
  lat DOUBLE NULL,
  lng DOUBLE NULL,
  driver_id INT UNSIGNED NULL,
  driver_name VARCHAR(150) NULL,
  phone VARCHAR(50) NULL,
  day VARCHAR(50) NULL,
  shift VARCHAR(50) NULL,
  notes TEXT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_workers_driver (driver_id),
  CONSTRAINT fk_workers_driver FOREIGN KEY (driver_id) REFERENCES drivers(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- audit logs
CREATE TABLE IF NOT EXISTS audit_logs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id INT UNSIGNED NULL,
  action VARCHAR(100) NOT NULL,
  ip VARCHAR(45) NULL,
  metadata JSON NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_audit_user (user_id),
  KEY idx_audit_action (action)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- seed roles
INSERT IGNORE INTO roles (id, name, description) VALUES
(1, 'admin', 'Administrator with full privileges'),
(2, 'user', 'Regular authenticated user');