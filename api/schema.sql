CREATE TABLE IF NOT EXISTS app_settings (
    id TINYINT UNSIGNED NOT NULL PRIMARY KEY,
    settings JSON NOT NULL,
    order_sequence BIGINT UNSIGNED NOT NULL DEFAULT 0,
    CHECK (id = 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS admins (
    username VARCHAR(80) NOT NULL PRIMARY KEY,
    password_hash VARCHAR(255) NOT NULL,
    auth_version BIGINT UNSIGNED NOT NULL DEFAULT 1
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS participants (
    owner_hash CHAR(64) NOT NULL PRIMARY KEY,
    created BIGINT NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS campaigns (
    id CHAR(32) NOT NULL PRIMARY KEY,
    data JSON NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS reservations (
    id CHAR(32) NOT NULL PRIMARY KEY,
    owner_hash CHAR(64) NOT NULL,
    request_id VARCHAR(128) NOT NULL,
    request_hash CHAR(64) NOT NULL,
    campaign_id CHAR(32) NOT NULL,
    status ENUM('reserved', 'sold', 'cancelled') NOT NULL,
    expires BIGINT NOT NULL,
    data JSON NOT NULL,
    UNIQUE KEY reservation_request (owner_hash, request_id),
    KEY reservation_campaign (campaign_id, status, expires),
    FOREIGN KEY (owner_hash) REFERENCES participants(owner_hash),
    FOREIGN KEY (campaign_id) REFERENCES campaigns(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS login_limits (
    identifier_hash CHAR(64) NOT NULL PRIMARY KEY,
    window_started BIGINT NOT NULL,
    failures INT UNSIGNED NOT NULL DEFAULT 0,
    blocked_until BIGINT NOT NULL DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
