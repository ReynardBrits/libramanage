USE libramanage;

-- Demonstration only: adjust the test loan's dates.
SET @demo_member_number = 'LM-000001';
SET @demo_book_title = 'Clean Code';
SET @demo_now = UTC_TIMESTAMP();

-- Find this member's most recent open loan for the chosen book.
SET @demo_loan_id = (
  SELECT l.loan_id
  FROM loans AS l
  INNER JOIN members AS m
    ON m.member_id = l.member_id
  INNER JOIN book_copies AS bc
    ON bc.copy_id = l.copy_id
  INNER JOIN books AS b
    ON b.book_id = bc.book_id
  WHERE m.member_number = @demo_member_number
    AND b.title = @demo_book_title
    AND l.return_date IS NULL
    AND NOT EXISTS (
      SELECT 1
      FROM fines AS f
      WHERE f.loan_id = l.loan_id
    )
  ORDER BY l.loan_id DESC
  LIMIT 1
);

-- Keep the issue date before the due date.
-- The loan becomes three calendar days overdue.
UPDATE loans
SET
  issue_date = DATE_SUB(@demo_now, INTERVAL 17 DAY),
  due_date = DATE_SUB(@demo_now, INTERVAL 3 DAY),
  loan_status = 'overdue'
WHERE loan_id = @demo_loan_id
  AND return_date IS NULL;

SELECT ROW_COUNT() AS updated_loans;

-- Display the selected loan and its expected fine.
SELECT
  l.loan_id,
  m.member_number,
  b.title,
  bc.barcode,

  DATE_FORMAT(
    DATE_ADD(l.issue_date, INTERVAL 2 HOUR),
    '%Y-%m-%d'
  ) AS issue_date,

  DATE_FORMAT(
    DATE_ADD(l.due_date, INTERVAL 2 HOUR),
    '%Y-%m-%d'
  ) AS due_date,

  GREATEST(
    DATEDIFF(
      DATE_ADD(@demo_now, INTERVAL 2 HOUR),
      DATE_ADD(l.due_date, INTERVAL 2 HOUR)
    ),
    0
  ) AS overdue_days,

  l.daily_fine_rate,

  ROUND(
    GREATEST(
      DATEDIFF(
        DATE_ADD(@demo_now, INTERVAL 2 HOUR),
        DATE_ADD(l.due_date, INTERVAL 2 HOUR)
      ),
      0
    ) * l.daily_fine_rate,
    2
  ) AS expected_fine

FROM loans AS l
INNER JOIN members AS m
  ON m.member_id = l.member_id
INNER JOIN book_copies AS bc
  ON bc.copy_id = l.copy_id
INNER JOIN books AS b
  ON b.book_id = bc.book_id
WHERE l.loan_id = @demo_loan_id;