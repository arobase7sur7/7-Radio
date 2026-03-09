CREATE TABLE IF NOT EXISTS `radio_history` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `frequency` VARCHAR(10) NOT NULL,
    `sender` VARCHAR(100) NOT NULL,
    `citizenid` VARCHAR(50) DEFAULT NULL,
    `message` TEXT NOT NULL,
    `timestamp` BIGINT NOT NULL,
    PRIMARY KEY (`id`),
    KEY `idx_radio_history_frequency_id` (`frequency`, `id`),
    KEY `idx_radio_history_citizenid_timestamp` (`citizenid`, `timestamp`),
    KEY `idx_radio_history_timestamp` (`timestamp`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `radio_macros` (
    `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
    `identifier` VARCHAR(60) NOT NULL,
    `label` VARCHAR(50) NOT NULL,
    `value` TEXT NOT NULL,
    `description` VARCHAR(255) DEFAULT NULL,
    `created_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    KEY `idx_radio_macros_identifier` (`identifier`),
    KEY `idx_radio_macros_identifier_label` (`identifier`, `label`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
