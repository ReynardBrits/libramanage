const pool = require("../config/database");

const PAGE_SIZE = 20;

function httpError(status, message) {
    return Object.assign(new Error(message), { status });
}

async function transaction(work) {
    const connection = await pool.getConnection();
    let started = false;

    try {
        await connection.beginTransaction();
        started = true;

        const result = await work(connection);

        await connection.commit();
        started = false;

        return result;
    } catch (error) {
        if (started) {
            try {
                await connection.rollback();
            } catch (rollbackError) {
                console.error("Loan rollback failed:", rollbackError.message);
            }
        }

        throw error;
    } finally {
        connection.release();
    }
}

async function readPolicies(connection, lock = false) {
    const [rows] = await connection.execute(`
    SELECT
      policy_name,
      policy_value
    FROM system_policies
    WHERE policy_name IN (
      'loan_period_days',
      'max_active_loans',
      'daily_fine_rate'
    )
    ${lock ? "FOR SHARE" : ""}
  `);

    const settings = Object.fromEntries(
        rows.map(row => [row.policy_name, row.policy_value])
    );

    const validInteger = (value, maximum) => {
        return (
            typeof value === "string"
            && /^[1-9]\d*$/.test(value)
            && Number(value) <= maximum
        );
    };

    const rate = settings.daily_fine_rate;

    if (
        !validInteger(settings.loan_period_days, 365)
        || !validInteger(settings.max_active_loans, 50)
        || typeof rate !== "string"
        || !/^(0|[1-9]\d{0,3})(\.\d{1,2})?$/.test(rate)
        || Number(rate) > 1000
    ) {
        throw httpError(
            503,
            "Borrowing policies are missing or invalid. Ask an administrator to check them."
        );
    }

    return {
        loanPeriodDays: Number(settings.loan_period_days),
        maxActiveLoans: Number(settings.max_active_loans),
        dailyFineRate: rate
    };
}

async function getOptions() {
    const [branchResult, policies] = await Promise.all([
        pool.execute(`
      SELECT
        branch_id AS branchId,
        branch_name AS branchName
      FROM branches
      WHERE status = 'active'
      ORDER BY branch_name
    `),
        readPolicies(pool)
    ]);

    return {
        branches: branchResult[0],
        policies
    };
}

async function findCopies({ search, branchId }) {
    const parameters = [];

    const conditions = [
        "b.status = 'active'",
        "br.status = 'active'",
        "bc.copy_status = 'available'",
        `NOT EXISTS (
      SELECT 1
      FROM loans AS l
      WHERE l.copy_id = bc.copy_id
        AND l.return_date IS NULL
    )`
    ];

    if (search) {
        conditions.push(`(
      LOCATE(?, b.title) > 0
      OR LOCATE(?, b.isbn) > 0
      OR LOCATE(?, bc.barcode) > 0
    )`);

        parameters.push(search, search, search);
    }

    if (branchId) {
        conditions.push("bc.branch_id = ?");
        parameters.push(branchId);
    }

    const [rows] = await pool.execute(`
    SELECT
      bc.copy_id AS copyId,
      bc.barcode,
      b.title,
      br.branch_name AS branchName
    FROM book_copies AS bc
    INNER JOIN books AS b
      ON b.book_id = bc.book_id
    INNER JOIN branches AS br
      ON br.branch_id = bc.branch_id
    WHERE ${conditions.join(" AND ")}
    ORDER BY
      b.title,
      br.branch_name,
      bc.barcode
    LIMIT 31
  `, parameters);

    return {
        copies: rows.slice(0, 30),
        hasMore: rows.length > 30
    };
}

async function listLoans({ search, status, page }) {
    const parameters = [];
    const conditions = [];

    // Timestamps are stored in UTC.
    // Calendar dates are displayed using South African time.
    const overdue = `
    DATE(DATE_ADD(l.due_date, INTERVAL 2 HOUR))
    < DATE(DATE_ADD(UTC_TIMESTAMP(), INTERVAL 2 HOUR))
  `;

    if (status === "open") {
        conditions.push("l.return_date IS NULL");
    }

    if (status === "returned") {
        conditions.push("l.return_date IS NOT NULL");
    }

    if (status === "overdue") {
        conditions.push("l.return_date IS NULL", overdue);
    }

    if (search) {
        conditions.push(`(
      LOCATE(?, b.title) > 0
      OR LOCATE(?, bc.barcode) > 0
      OR LOCATE(?, m.member_number) > 0
      OR LOCATE(?, CONCAT(u.first_name, ' ', u.last_name)) > 0
    )`);

        parameters.push(search, search, search, search);
    }

    const from = `
    FROM loans AS l
    INNER JOIN book_copies AS bc
      ON bc.copy_id = l.copy_id
    INNER JOIN books AS b
      ON b.book_id = bc.book_id
    INNER JOIN members AS m
      ON m.member_id = l.member_id
    INNER JOIN users AS u
      ON u.user_id = m.user_id
  `;

    const where = conditions.length
        ? `WHERE ${conditions.join(" AND ")}`
        : "";

    const [counts] = await pool.execute(`
    SELECT COUNT(*) AS total
    ${from}
    ${where}
  `, parameters);

    const total = Number(counts[0].total);
    const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
    const currentPage = Math.min(page, pageCount);
    const offset = (currentPage - 1) * PAGE_SIZE;

    const [loans] = await pool.execute(`
    SELECT
      l.loan_id AS loanId,
      b.title,
      bc.barcode,
      m.member_number AS memberNumber,
      CONCAT(u.first_name, ' ', u.last_name) AS memberName,

      DATE_FORMAT(
        DATE_ADD(l.issue_date, INTERVAL 2 HOUR),
        '%Y-%m-%d'
      ) AS issueDate,

      DATE_FORMAT(
        DATE_ADD(l.due_date, INTERVAL 2 HOUR),
        '%Y-%m-%d'
      ) AS dueDate,

      DATE_FORMAT(
        DATE_ADD(l.return_date, INTERVAL 2 HOUR),
        '%Y-%m-%d'
      ) AS returnDate,

      CASE
        WHEN l.return_date IS NOT NULL THEN 'returned'
        WHEN ${overdue} THEN 'overdue'
        ELSE 'active'
      END AS status,

      ROUND(
        GREATEST(
          DATEDIFF(
            DATE_ADD(
              COALESCE(l.return_date, UTC_TIMESTAMP()),
              INTERVAL 2 HOUR
            ),
            DATE_ADD(l.due_date, INTERVAL 2 HOUR)
          ),
          0
        ) * l.daily_fine_rate,
        2
      ) AS estimatedFine,

      COALESCE(f.amount, 0.00) AS fineAmount

    ${from}

    LEFT JOIN fines AS f
      ON f.loan_id = l.loan_id

    ${where}

    ORDER BY
      (l.return_date IS NULL) DESC,
      l.loan_id DESC

    LIMIT ${PAGE_SIZE} OFFSET ${offset}
  `, parameters);

    return {
        loans,
        pagination: {
            page: currentPage,
            pageCount,
            pageSize: PAGE_SIZE,
            total
        }
    };
}

async function issueBook({ copyId, memberNumber }, staffId) {
    return transaction(async connection => {
        const [initialCopies] = await connection.execute(`
      SELECT book_id AS bookId
      FROM book_copies
      WHERE copy_id = ?
    `, [copyId]);

        if (!initialCopies.length) {
            throw httpError(404, "Book copy not found.");
        }

        const bookId = initialCopies[0].bookId;

        // Lock the parent book first, matching book archiving.
        const [books] = await connection.execute(`
      SELECT status
      FROM books
      WHERE book_id = ?
      FOR UPDATE
    `, [bookId]);

        if (!books.length || books[0].status !== "active") {
            throw httpError(
                409,
                "This book is archived and cannot be issued."
            );
        }

        const [members] = await connection.execute(`
      SELECT
        m.member_id AS memberId,
        m.borrowing_status AS borrowingStatus,
        u.status AS userStatus,
        CONCAT(u.first_name, ' ', u.last_name) AS memberName
      FROM members AS m
      INNER JOIN users AS u
        ON u.user_id = m.user_id
      WHERE m.member_number = ?
      FOR UPDATE
    `, [memberNumber]);

        if (!members.length) {
            throw httpError(404, "Member number not found.");
        }

        const member = members[0];

        if (
            member.userStatus !== "active"
            || member.borrowingStatus !== "active"
        ) {
            throw httpError(
                409,
                "This member's account is inactive or borrowing is suspended."
            );
        }

        const policies = await readPolicies(connection, true);

        // Read current loans after acquiring the member lock.
        const [openLoans] = await connection.execute(`
      SELECT loan_id
      FROM loans
      WHERE member_id = ?
        AND return_date IS NULL
      FOR UPDATE
    `, [member.memberId]);

        if (openLoans.length >= policies.maxActiveLoans) {
            throw httpError(
                409,
                `This member has reached the limit of ${policies.maxActiveLoans} open loans.`
            );
        }

        const [copies] = await connection.execute(`
      SELECT
        book_id AS bookId,
        branch_id AS branchId,
        copy_status AS copyStatus
      FROM book_copies
      WHERE copy_id = ?
      FOR UPDATE
    `, [copyId]);

        const copy = copies[0];

        if (
            !copy
            || copy.bookId !== bookId
            || copy.copyStatus !== "available"
        ) {
            throw httpError(
                409,
                "This copy is no longer available. Search again."
            );
        }

        const [branches] = await connection.execute(`
      SELECT status
      FROM branches
      WHERE branch_id = ?
      FOR SHARE
    `, [copy.branchId]);

        if (!branches.length || branches[0].status !== "active") {
            throw httpError(
                409,
                "This copy's branch is inactive."
            );
        }

        const [insert] = await connection.execute(`
      INSERT INTO loans (
        copy_id,
        member_id,
        issued_by,
        issue_date,
        due_date,
        daily_fine_rate
      )
      VALUES (
        ?,
        ?,
        ?,
        UTC_TIMESTAMP(),
        DATE_ADD(UTC_TIMESTAMP(), INTERVAL ? DAY),
        ?
      )
    `, [
            copyId,
            member.memberId,
            staffId,
            policies.loanPeriodDays,
            policies.dailyFineRate
        ]);

        await connection.execute(`
      UPDATE book_copies
      SET copy_status = 'on_loan'
      WHERE copy_id = ?
    `, [copyId]);

        const [dates] = await connection.execute(`
      SELECT DATE_FORMAT(
        DATE_ADD(due_date, INTERVAL 2 HOUR),
        '%Y-%m-%d'
      ) AS dueDate
      FROM loans
      WHERE loan_id = ?
    `, [insert.insertId]);

        return {
            loanId: insert.insertId,
            dueDate: dates[0].dueDate,
            message:
                `Book issued to ${member.memberName}. `
                + `Due date: ${dates[0].dueDate}.`
        };
    });
}

async function returnBook(loanId, staffId) {
    return transaction(async connection => {
        const [initialLoans] = await connection.execute(`
      SELECT
        l.copy_id AS copyId,
        l.member_id AS memberId,
        bc.book_id AS bookId
      FROM loans AS l
      INNER JOIN book_copies AS bc
        ON bc.copy_id = l.copy_id
      WHERE l.loan_id = ?
    `, [loanId]);

        if (!initialLoans.length) {
            throw httpError(404, "Loan not found.");
        }

        const initial = initialLoans[0];

        await connection.execute(`
      SELECT book_id
      FROM books
      WHERE book_id = ?
      FOR UPDATE
    `, [initial.bookId]);

        await connection.execute(`
      SELECT member_id
      FROM members
      WHERE member_id = ?
      FOR UPDATE
    `, [initial.memberId]);

        const [copies] = await connection.execute(`
      SELECT copy_status AS copyStatus
      FROM book_copies
      WHERE copy_id = ?
      FOR UPDATE
    `, [initial.copyId]);

        const [loans] = await connection.execute(`
      SELECT
        loan_status AS loanStatus,

        DATE_FORMAT(
          UTC_TIMESTAMP(),
          '%Y-%m-%d %H:%i:%s'
        ) AS returnedAt,

        GREATEST(
          DATEDIFF(
            DATE_ADD(UTC_TIMESTAMP(), INTERVAL 2 HOUR),
            DATE_ADD(due_date, INTERVAL 2 HOUR)
          ),
          0
        ) AS overdueDays

      FROM loans
      WHERE loan_id = ?
      FOR UPDATE
    `, [loanId]);

        const loan = loans[0];

        if (!loan) {
            throw httpError(404, "Loan not found.");
        }

        if (loan.loanStatus === "returned") {
            return {
                loanId,
                message:
                    "This loan was already returned. No additional fine was added."
            };
        }

        if (!copies.length || copies[0].copyStatus !== "on_loan") {
            throw httpError(
                409,
                "The copy's stock status does not match this open loan. Ask an administrator to check it."
            );
        }

        const overdueDays = Number(loan.overdueDays);

        if (overdueDays > 0) {
            // Calculate money using integer and DECIMAL arithmetic.
            await connection.execute(`
        INSERT INTO fines (
          loan_id,
          overdue_days,
          daily_rate,
          amount
        )
        SELECT
          loan_id,
          CAST(? AS UNSIGNED),
          daily_fine_rate,
          ROUND(
            CAST(? AS UNSIGNED) * daily_fine_rate,
            2
          )
        FROM loans
        WHERE loan_id = ?
          AND daily_fine_rate > 0
      `, [overdueDays, overdueDays, loanId]);
        }

        await connection.execute(`
      UPDATE loans
      SET
        loan_status = 'returned',
        return_date = ?,
        returned_by = ?
      WHERE loan_id = ?
    `, [
            loan.returnedAt,
            staffId,
            loanId
        ]);

        await connection.execute(`
      UPDATE book_copies
      SET copy_status = 'available'
      WHERE copy_id = ?
    `, [initial.copyId]);

        const [fines] = await connection.execute(`
      SELECT amount
      FROM fines
      WHERE loan_id = ?
      FOR SHARE
    `, [loanId]);

        const fineAmount = fines.length
            ? fines[0].amount
            : "0.00";

        return {
            loanId,
            overdueDays,
            fineAmount,
            message: fines.length
                ? `Book returned. An overdue fine of R${fineAmount} was recorded.`
                : "Book returned. No overdue fine was charged."
        };
    });
}

module.exports = {
    getOptions,
    findCopies,
    listLoans,
    issueBook,
    returnBook
};