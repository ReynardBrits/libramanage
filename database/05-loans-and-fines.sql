USE libramanage;

-- =====================================================
-- Loans
-- Records which member borrowed a physical book copy.
-- =====================================================

CREATE TABLE IF NOT EXISTS loans (
    loan_id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    copy_id INT UNSIGNED NOT NULL,
    member_id INT UNSIGNED NOT NULL,
    issued_by INT UNSIGNED NOT NULL,
    returned_by INT UNSIGNED NULL,

    issue_date DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    due_date DATETIME NOT NULL,
    return_date DATETIME NULL,

    loan_status ENUM('active', 'returned', 'overdue')
        NOT NULL DEFAULT 'active',

    renewal_count TINYINT UNSIGNED NOT NULL DEFAULT 0,

    -- Keep the rate applied when this loan was issued.
    daily_fine_rate DECIMAL(10, 2) NOT NULL DEFAULT 2.00,

    -- An open loan exposes its copy ID here.
    -- A returned loan exposes NULL, allowing future loans
    -- for the same physical copy.
    open_copy_id INT UNSIGNED
        GENERATED ALWAYS AS (
            CASE
                WHEN return_date IS NULL THEN copy_id
                ELSE NULL
            END
        ) STORED,

    UNIQUE KEY uq_loans_open_copy (open_copy_id),

    INDEX idx_loans_member_status (member_id, loan_status),
    INDEX idx_loans_due_date (loan_status, due_date),
    INDEX idx_loans_copy_history (copy_id, issue_date),

    CONSTRAINT fk_loans_copy
        FOREIGN KEY (copy_id)
        REFERENCES book_copies(copy_id),

    CONSTRAINT fk_loans_member
        FOREIGN KEY (member_id)
        REFERENCES members(member_id),

    CONSTRAINT fk_loans_issuer
        FOREIGN KEY (issued_by)
        REFERENCES users(user_id),

    CONSTRAINT fk_loans_returner
        FOREIGN KEY (returned_by)
        REFERENCES users(user_id),

    CONSTRAINT chk_loans_due_after_issue
        CHECK (due_date > issue_date),

    CONSTRAINT chk_loans_return_after_issue
        CHECK (
            return_date IS NULL
            OR return_date >= issue_date
        ),

    CONSTRAINT chk_loans_return_status
        CHECK (
            (
                loan_status IN ('active', 'overdue')
                AND return_date IS NULL
            )
            OR
            (
                loan_status = 'returned'
                AND return_date IS NOT NULL
            )
        ),

    CONSTRAINT chk_loans_fine_rate
        CHECK (daily_fine_rate >= 0)
) ENGINE = InnoDB;


-- =====================================================
-- Fines
-- One overdue fine can be recorded for each loan.
-- =====================================================

CREATE TABLE IF NOT EXISTS fines (
    fine_id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    loan_id INT UNSIGNED NOT NULL,

    overdue_days INT UNSIGNED NOT NULL,
    daily_rate DECIMAL(10, 2) NOT NULL DEFAULT 2.00,
    amount DECIMAL(10, 2) NOT NULL,

    fine_status ENUM('unpaid', 'partially_paid', 'paid')
        NOT NULL DEFAULT 'unpaid',

    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    UNIQUE KEY uq_fines_loan (loan_id),
    INDEX idx_fines_status (fine_status, created_at),

    CONSTRAINT fk_fines_loan
        FOREIGN KEY (loan_id)
        REFERENCES loans(loan_id),

    CONSTRAINT chk_fines_overdue_days
        CHECK (overdue_days > 0),

    CONSTRAINT chk_fines_daily_rate
        CHECK (daily_rate > 0),

    CONSTRAINT chk_fines_amount
        CHECK (amount > 0)
) ENGINE = InnoDB;


-- =====================================================
-- Payments
-- Supports full or partial payments against a fine.
-- =====================================================

CREATE TABLE IF NOT EXISTS payments (
    payment_id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    fine_id INT UNSIGNED NOT NULL,
    recorded_by INT UNSIGNED NOT NULL,

    amount DECIMAL(10, 2) NOT NULL,
    payment_date DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    INDEX idx_payments_fine_date (fine_id, payment_date),

    CONSTRAINT fk_payments_fine
        FOREIGN KEY (fine_id)
        REFERENCES fines(fine_id),

    CONSTRAINT fk_payments_recorder
        FOREIGN KEY (recorded_by)
        REFERENCES users(user_id),

    CONSTRAINT chk_payments_amount
        CHECK (amount > 0)
) ENGINE = InnoDB;


-- =====================================================
-- System policies
-- Stores configurable borrowing rules.
-- NULL updated_by means an initial setup value.
-- =====================================================

CREATE TABLE IF NOT EXISTS system_policies (
    policy_id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,

    policy_name VARCHAR(100) NOT NULL,
    policy_value VARCHAR(100) NOT NULL,

    updated_by INT UNSIGNED NULL,

    updated_at DATETIME NOT NULL
        DEFAULT CURRENT_TIMESTAMP
        ON UPDATE CURRENT_TIMESTAMP,

    UNIQUE KEY uq_system_policies_name (policy_name),

    CONSTRAINT fk_system_policies_user
        FOREIGN KEY (updated_by)
        REFERENCES users(user_id)
) ENGINE = InnoDB;


-- Initial demonstration settings.
-- Existing policy values are preserved if this is run again.

INSERT INTO system_policies (
    policy_name,
    policy_value
)
VALUES
    ('loan_period_days', '14'),
    ('max_active_loans', '5'),
    ('daily_fine_rate', '2.00'),
    ('max_renewals', '2')
ON DUPLICATE KEY UPDATE
    policy_name = system_policies.policy_name;


-- =====================================================
-- Verification
-- =====================================================

SELECT
    TABLE_NAME AS table_name
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = 'libramanage'
  AND TABLE_NAME IN (
      'loans',
      'fines',
      'payments',
      'system_policies'
  )
ORDER BY TABLE_NAME;

SELECT
    policy_name,
    policy_value
FROM system_policies
ORDER BY policy_name;

SELECT COUNT(*) AS total_loans
FROM loans;