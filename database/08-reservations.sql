USE libramanage;

CREATE TABLE IF NOT EXISTS reservations (
  reservation_id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  book_id INT UNSIGNED NOT NULL,
  member_id INT UNSIGNED NOT NULL,
  branch_id INT UNSIGNED NOT NULL,
  copy_id INT UNSIGNED NULL,
  loan_id INT UNSIGNED NULL,
  prepared_by INT UNSIGNED NULL,

  reservation_date DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ready_at DATETIME NULL,
  held_until DATETIME NULL,
  closed_at DATETIME NULL,

  reservation_status ENUM(
    'queued',
    'ready',
    'collected',
    'cancelled',
    'expired'
  ) NOT NULL DEFAULT 'queued',

  -- Only queued and ready reservations count as active.
  active_member_id INT UNSIGNED GENERATED ALWAYS AS (
    CASE
      WHEN reservation_status IN ('queued', 'ready') THEN member_id
      ELSE NULL
    END
  ) STORED,

  -- A physical copy can be held by only one ready reservation.
  active_copy_id INT UNSIGNED GENERATED ALWAYS AS (
    CASE
      WHEN reservation_status = 'ready' THEN copy_id
      ELSE NULL
    END
  ) STORED,

  UNIQUE KEY uq_reservations_active_member_book (
    book_id,
    active_member_id
  ),

  UNIQUE KEY uq_reservations_active_copy (active_copy_id),
  UNIQUE KEY uq_reservations_loan (loan_id),

  INDEX idx_reservations_queue (
    book_id,
    branch_id,
    reservation_status,
    reservation_date,
    reservation_id
  ),

  INDEX idx_reservations_member (
    member_id,
    reservation_status,
    reservation_date
  ),

  INDEX idx_reservations_expiry (
    reservation_status,
    held_until
  ),

  CONSTRAINT fk_reservations_book
    FOREIGN KEY (book_id) REFERENCES books(book_id),

  CONSTRAINT fk_reservations_member
    FOREIGN KEY (member_id) REFERENCES members(member_id),

  CONSTRAINT fk_reservations_branch
    FOREIGN KEY (branch_id) REFERENCES branches(branch_id),

  CONSTRAINT fk_reservations_copy
    FOREIGN KEY (copy_id) REFERENCES book_copies(copy_id),

  CONSTRAINT fk_reservations_loan
    FOREIGN KEY (loan_id) REFERENCES loans(loan_id),

  CONSTRAINT fk_reservations_prepared_by
    FOREIGN KEY (prepared_by) REFERENCES users(user_id),

  CONSTRAINT chk_reservations_ready_date CHECK (
    ready_at IS NULL OR ready_at >= reservation_date
  ),

  CONSTRAINT chk_reservations_hold_date CHECK (
    held_until IS NULL
    OR (ready_at IS NOT NULL AND held_until > ready_at)
  ),

  CONSTRAINT chk_reservations_closed_date CHECK (
    closed_at IS NULL OR closed_at >= reservation_date
  ),

  CONSTRAINT chk_reservations_assignment CHECK (
    (
      copy_id IS NULL
      AND prepared_by IS NULL
      AND ready_at IS NULL
      AND held_until IS NULL
    )
    OR (
      copy_id IS NOT NULL
      AND prepared_by IS NOT NULL
      AND ready_at IS NOT NULL
      AND held_until IS NOT NULL
    )
  ),

  CONSTRAINT chk_reservations_state CHECK (
    (
      reservation_status = 'queued'
      AND copy_id IS NULL
      AND loan_id IS NULL
      AND closed_at IS NULL
    )
    OR (
      reservation_status = 'ready'
      AND copy_id IS NOT NULL
      AND loan_id IS NULL
      AND closed_at IS NULL
    )
    OR (
      reservation_status = 'collected'
      AND copy_id IS NOT NULL
      AND loan_id IS NOT NULL
      AND closed_at IS NOT NULL
    )
    OR (
      reservation_status = 'cancelled'
      AND loan_id IS NULL
      AND closed_at IS NOT NULL
    )
    OR (
      reservation_status = 'expired'
      AND copy_id IS NOT NULL
      AND loan_id IS NULL
      AND closed_at IS NOT NULL
    )
  )
) ENGINE = InnoDB;

-- Add defaults while preserving any policies that already exist.
INSERT INTO system_policies (policy_name, policy_value)
VALUES
  ('reservation_hold_hours', '48'),
  ('max_active_reservations', '3')
ON DUPLICATE KEY UPDATE
  policy_name = system_policies.policy_name;

SHOW TABLES LIKE 'reservations';

SELECT COUNT(*) AS total_reservations
FROM reservations;

SELECT policy_name, policy_value
FROM system_policies
WHERE policy_name IN (
  'reservation_hold_hours',
  'max_active_reservations'
)
ORDER BY policy_name;