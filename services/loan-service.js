const pool = require("../config/database");
const { pagination, transaction } = require("../utils/service-helpers");
const { readPolicies } = require("../utils/library-policies");
const { expireBookLocked } = require("./reservation-service");

const PAGE_SIZE = 20;

function httpError(status, message) {
    return Object.assign(new Error(message), { status });
}

async function getOptions() {
    const [branchResult, policies] = await Promise.all([
        pool.execute(`
            SELECT branch_id AS branchId, branch_name AS branchName
            FROM branches WHERE status = 'active' ORDER BY branch_name
        `),
        readPolicies(pool)
    ]);

    return { branches: branchResult[0], policies };
}

async function findCopies({ search, branchId }) {
    const parameters = [];
    const conditions = [
        "b.status = 'active'",
        "br.status = 'active'",
        "bc.copy_status = 'available'",
        `NOT EXISTS (
            SELECT 1 FROM reservations AS r
            WHERE r.book_id = bc.book_id AND r.branch_id = bc.branch_id
                AND r.reservation_status = 'queued'
        )`,
        `NOT EXISTS (
            SELECT 1 FROM loans AS l
            WHERE l.copy_id = bc.copy_id AND l.return_date IS NULL
        )`
    ];

    if (search) {
        conditions.push(`(
            LOCATE(?, b.title) > 0 OR LOCATE(?, b.isbn) > 0
            OR LOCATE(?, bc.barcode) > 0
        )`);
        parameters.push(search, search, search);
    }

    if (branchId) {
        conditions.push("bc.branch_id = ?");
        parameters.push(branchId);
    }

    const [rows] = await pool.execute(`
        SELECT bc.copy_id AS copyId, bc.barcode,
            b.title, br.branch_name AS branchName
        FROM book_copies AS bc
        INNER JOIN books AS b ON b.book_id = bc.book_id
        INNER JOIN branches AS br ON br.branch_id = bc.branch_id
        WHERE ${conditions.join(" AND ")}
        ORDER BY b.title, br.branch_name, bc.barcode
        LIMIT 31
    `, parameters);

    return { copies: rows.slice(0, 30), hasMore: rows.length > 30 };
}

async function listLoans({ search, status, page }) {
    const parameters = [];
    const conditions = [];

    // Dates are stored in UTC; South African calendar days use UTC+02:00.
    const overdue = `DATE(DATE_ADD(l.due_date, INTERVAL 2 HOUR))
        < DATE(DATE_ADD(UTC_TIMESTAMP(), INTERVAL 2 HOUR))`;

    if (status === "open") conditions.push("l.return_date IS NULL");
    if (status === "returned") conditions.push("l.return_date IS NOT NULL");

    if (status === "overdue") {
        conditions.push("l.return_date IS NULL", overdue);
    }

    if (search) {
        conditions.push(`(
            LOCATE(?, b.title) > 0 OR LOCATE(?, bc.barcode) > 0
            OR LOCATE(?, m.member_number) > 0
            OR LOCATE(?, CONCAT(u.first_name, ' ', u.last_name)) > 0
        )`);
        parameters.push(search, search, search, search);
    }

    const from = `FROM loans AS l
        INNER JOIN book_copies AS bc ON bc.copy_id = l.copy_id
        INNER JOIN books AS b ON b.book_id = bc.book_id
        INNER JOIN members AS m ON m.member_id = l.member_id
        INNER JOIN users AS u ON u.user_id = m.user_id`;

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

    const [counts] = await pool.execute(
        `SELECT COUNT(*) AS total ${from} ${where}`,
        parameters
    );

    const pageInfo = pagination(Number(counts[0].total), page, PAGE_SIZE);
    const offset = (pageInfo.page - 1) * PAGE_SIZE;

    const [loans] = await pool.execute(`
        SELECT l.loan_id AS loanId, b.title, bc.barcode,
            m.member_number AS memberNumber,
            CONCAT(u.first_name, ' ', u.last_name) AS memberName,
            DATE_FORMAT(
                DATE_ADD(l.issue_date, INTERVAL 2 HOUR), '%Y-%m-%d'
            ) AS issueDate,
            DATE_FORMAT(
                DATE_ADD(l.due_date, INTERVAL 2 HOUR), '%Y-%m-%d'
            ) AS dueDate,
            DATE_FORMAT(
                DATE_ADD(l.return_date, INTERVAL 2 HOUR), '%Y-%m-%d'
            ) AS returnDate,
            CASE
                WHEN l.return_date IS NOT NULL THEN 'returned'
                WHEN ${overdue} THEN 'overdue'
                ELSE 'active'
            END AS status,
            ROUND(GREATEST(DATEDIFF(
                DATE_ADD(
                    COALESCE(l.return_date, UTC_TIMESTAMP()), INTERVAL 2 HOUR
                ),
                DATE_ADD(l.due_date, INTERVAL 2 HOUR)
            ), 0) * l.daily_fine_rate, 2) AS estimatedFine,
            COALESCE(f.amount, 0.00) AS fineAmount
        ${from}
        LEFT JOIN fines AS f ON f.loan_id = l.loan_id
        ${where}
        ORDER BY (l.return_date IS NULL) DESC, l.loan_id DESC
        LIMIT ${PAGE_SIZE} OFFSET ${offset}
    `, parameters);

    return { loans, pagination: pageInfo };
}

async function issueBook({ copyId, memberNumber }, staffId) {
    return transaction(async connection => {
        const [initialCopies] = await connection.execute(
            "SELECT book_id AS bookId FROM book_copies WHERE copy_id = ?",
            [copyId]
        );

        if (!initialCopies.length) {
            throw httpError(404, "Book copy not found.");
        }

        const bookId = initialCopies[0].bookId;

        // Lock the parent book first, matching reservation and archive actions.
        const [books] = await connection.execute(
            "SELECT status FROM books WHERE book_id = ? FOR UPDATE",
            [bookId]
        );

        if (!books.length || books[0].status !== "active") {
            throw httpError(409, "This book is archived and cannot be issued.");
        }

        const [members] = await connection.execute(`
            SELECT m.member_id AS memberId,
                m.borrowing_status AS borrowingStatus,
                u.status AS userStatus,
                CONCAT(u.first_name, ' ', u.last_name) AS memberName
            FROM members AS m
            INNER JOIN users AS u ON u.user_id = m.user_id
            WHERE m.member_number = ? FOR UPDATE
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

        // Release expired holds while holding the book and member locks.
        const [clock] = await connection.execute(
            "SELECT DATE_FORMAT(UTC_TIMESTAMP(), '%Y-%m-%d %H:%i:%s') AS now"
        );

        await expireBookLocked(connection, bookId, clock[0].now);

        const policies = await readPolicies(connection, { lock: true });

        // A locking read sees current loans after waiting for the member lock.
        const [openLoans] = await connection.execute(`
            SELECT loan_id FROM loans
            WHERE member_id = ? AND return_date IS NULL FOR UPDATE
        `, [member.memberId]);

        if (openLoans.length >= policies.maxActiveLoans) {
            throw httpError(
                409,
                `This member has reached the limit of ${policies.maxActiveLoans} open loans.`
            );
        }

        const [copies] = await connection.execute(`
            SELECT book_id AS bookId, branch_id AS branchId,
                copy_status AS copyStatus
            FROM book_copies WHERE copy_id = ? FOR UPDATE
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

        const [branches] = await connection.execute(
            "SELECT status FROM branches WHERE branch_id = ? FOR SHARE",
            [copy.branchId]
        );

        if (!branches.length || branches[0].status !== "active") {
            throw httpError(409, "This copy's branch is inactive.");
        }

        // Queued members must be served through the reservation workflow.
        const [queue] = await connection.execute(`
            SELECT reservation_id FROM reservations
            WHERE book_id = ? AND branch_id = ?
                AND reservation_status = 'queued'
            ORDER BY reservation_date, reservation_id
            LIMIT 1 FOR UPDATE
        `, [bookId, copy.branchId]);

        if (queue.length) {
            throw httpError(
                409,
                "This book has a reservation queue at this branch. Prepare and collect it through Manage Reservations."
            );
        }

        const [insert] = await connection.execute(`
            INSERT INTO loans (
                copy_id, member_id, issued_by,
                issue_date, due_date, daily_fine_rate
            )
            VALUES (
                ?, ?, ?, UTC_TIMESTAMP(),
                DATE_ADD(UTC_TIMESTAMP(), INTERVAL ? DAY), ?
            )
        `, [
            copyId,
            member.memberId,
            staffId,
            policies.loanPeriodDays,
            policies.dailyFineRate
        ]);

        await connection.execute(
            "UPDATE book_copies SET copy_status = 'on_loan' WHERE copy_id = ?",
            [copyId]
        );

        const [dates] = await connection.execute(`
            SELECT DATE_FORMAT(
                DATE_ADD(due_date, INTERVAL 2 HOUR), '%Y-%m-%d'
            ) AS dueDate
            FROM loans WHERE loan_id = ?
        `, [insert.insertId]);

        return {
            loanId: insert.insertId,
            dueDate: dates[0].dueDate,
            message: `Book issued to ${member.memberName}. Due date: ${dates[0].dueDate}.`
        };
    });
}

async function returnBook(loanId, staffId) {
    return transaction(async connection => {
        const [initialLoans] = await connection.execute(`
            SELECT l.copy_id AS copyId, l.member_id AS memberId,
                bc.book_id AS bookId
            FROM loans AS l
            INNER JOIN book_copies AS bc ON bc.copy_id = l.copy_id
            WHERE l.loan_id = ?
        `, [loanId]);

        if (!initialLoans.length) {
            throw httpError(404, "Loan not found.");
        }

        const initial = initialLoans[0];

        await connection.execute(
            "SELECT book_id FROM books WHERE book_id = ? FOR UPDATE",
            [initial.bookId]
        );

        await connection.execute(
            "SELECT member_id FROM members WHERE member_id = ? FOR UPDATE",
            [initial.memberId]
        );

        const [copies] = await connection.execute(`
            SELECT copy_status AS copyStatus FROM book_copies
            WHERE copy_id = ? FOR UPDATE
        `, [initial.copyId]);

        const [loans] = await connection.execute(`
            SELECT loan_status AS loanStatus,
                DATE_FORMAT(
                    UTC_TIMESTAMP(), '%Y-%m-%d %H:%i:%s'
                ) AS returnedAt,
                GREATEST(DATEDIFF(
                    DATE_ADD(UTC_TIMESTAMP(), INTERVAL 2 HOUR),
                    DATE_ADD(due_date, INTERVAL 2 HOUR)
                ), 0) AS overdueDays
            FROM loans WHERE loan_id = ? FOR UPDATE
        `, [loanId]);

        const loan = loans[0];

        if (!loan) {
            throw httpError(404, "Loan not found.");
        }

        if (loan.loanStatus === "returned") {
            return {
                loanId,
                message: "This loan was already returned. No additional fine was added."
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
            // Calculate money in MySQL using the loan's stored DECIMAL rate.
            await connection.execute(`
                INSERT INTO fines (loan_id, overdue_days, daily_rate, amount)
                SELECT loan_id, CAST(? AS UNSIGNED), daily_fine_rate,
                    ROUND(CAST(? AS UNSIGNED) * daily_fine_rate, 2)
                FROM loans WHERE loan_id = ? AND daily_fine_rate > 0
            `, [overdueDays, overdueDays, loanId]);
        }

        await connection.execute(`
            UPDATE loans
            SET loan_status = 'returned', return_date = ?, returned_by = ?
            WHERE loan_id = ?
        `, [loan.returnedAt, staffId, loanId]);

        await connection.execute(
            "UPDATE book_copies SET copy_status = 'available' WHERE copy_id = ?",
            [initial.copyId]
        );

        const [fines] = await connection.execute(
            "SELECT amount FROM fines WHERE loan_id = ? FOR SHARE",
            [loanId]
        );

        const fineAmount = fines.length ? fines[0].amount : "0.00";

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