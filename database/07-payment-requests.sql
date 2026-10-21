USE libramanage;

-- Links a unique submission key to its recorded payment.
-- The backend will use this to recognise repeated requests.

CREATE TABLE IF NOT EXISTS payment_requests (
  request_key CHAR(36)
    CHARACTER SET ascii
    COLLATE ascii_bin
    NOT NULL,

  payment_id INT UNSIGNED NOT NULL,

  created_at DATETIME NOT NULL
    DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (request_key),

  UNIQUE KEY uq_payment_requests_payment (
    payment_id
  ),

  CONSTRAINT fk_payment_requests_payment
    FOREIGN KEY (payment_id)
    REFERENCES payments(payment_id)
) ENGINE = InnoDB;


-- Confirm that the table exists.

SHOW TABLES LIKE 'payment_requests';


-- Confirm its relationship to the payments table.

SELECT
  TABLE_NAME AS table_name,
  COLUMN_NAME AS column_name,
  REFERENCED_TABLE_NAME AS referenced_table,
  REFERENCED_COLUMN_NAME AS referenced_column
FROM information_schema.KEY_COLUMN_USAGE
WHERE TABLE_SCHEMA = 'libramanage'
  AND TABLE_NAME = 'payment_requests'
  AND REFERENCED_TABLE_NAME IS NOT NULL;


-- Initially, there should be no payment requests.

SELECT COUNT(*) AS total_payment_requests
FROM payment_requests;