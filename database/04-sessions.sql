-- LibraManage: storage for login sessions

USE libramanage;

CREATE TABLE IF NOT EXISTS sessions (
    session_id VARCHAR(128)
        CHARACTER SET utf8mb4
        COLLATE utf8mb4_bin
        NOT NULL,

    expires INT UNSIGNED NOT NULL,

    data MEDIUMTEXT
        CHARACTER SET utf8mb4
        COLLATE utf8mb4_bin
        NOT NULL,

    PRIMARY KEY (session_id),

    INDEX idx_sessions_expires (expires)
) ENGINE=InnoDB;

-- Check that the table was created.
SHOW COLUMNS FROM sessions;