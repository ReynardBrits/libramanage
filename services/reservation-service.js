const pool = require("../config/database");
const { fail, pagination, transaction } = require("../utils/service-helpers");
const { readPolicies } = require("../utils/library-policies");

const PAGE_SIZE = 10;
const ACTIVE_SQL = `(r.reservation_status = 'queued' OR (
  r.reservation_status = 'ready' AND r.held_until > ?
))`;

async function clock(connection) {
    const [rows] = await connection.execute(`
    SELECT DATE_FORMAT(UTC_TIMESTAMP(), '%Y-%m-%d %H:%i:%s') AS now
  `);
    return rows[0].now;
}

async function memberRecord(connection, value, byUser = true, lock = false, allowInactive = false) {
    const [rows] = await connection.execute(`
    SELECT u.user_id AS userId, u.status AS userStatus,
      m.member_id AS memberId, m.member_number AS memberNumber,
      m.borrowing_status AS borrowingStatus
    FROM users AS u
    LEFT JOIN members AS m ON m.user_id = u.user_id
    WHERE ${byUser ? "u.user_id" : "m.member_id"} = ?
    ${lock ? "FOR UPDATE" : ""}
  `, [value]);

    const member = rows[0];
    if (!member || (!allowInactive && member.userStatus !== "active")) {
        throw fail(byUser ? 401 : 409, "ACCOUNT_INACTIVE", "The member's account is inactive or unavailable.");
    }

    if (!member.memberId) {
        throw fail(403, "MEMBERSHIP_REQUIRED", "A library membership is required to reserve books.");
    }

    return member;
}

function requireBorrowing(member) {
    if (member.userStatus !== "active") {
        throw fail(409, "ACCOUNT_INACTIVE", "The member's account is inactive.");
    }

    if (member.borrowingStatus !== "active") {
        throw fail(409, "BORROWING_SUSPENDED", "Borrowing is suspended for this member.");
    }
}

async function lockBook(connection, bookId) {
    const [rows] = await connection.execute(`
    SELECT book_id AS bookId, title, status
    FROM books WHERE book_id = ? FOR UPDATE
  `, [bookId]);

    if (!rows.length) throw fail(404, "BOOK_NOT_FOUND", "The book could not be found.");
    return rows[0];
}

async function activeBranch(connection, branchId) {
    const [rows] = await connection.execute(`
    SELECT branch_id FROM branches
    WHERE branch_id = ? AND status = 'active' FOR SHARE
  `, [branchId]);

    if (!rows.length) throw fail(409, "BRANCH_INACTIVE", "The collection branch is unavailable.");
}

async function lockCopy(connection, reservation, expectedStatus) {
    const [copies] = await connection.execute(`
    SELECT copy_id AS copyId, book_id AS bookId,
      branch_id AS branchId, copy_status AS copyStatus
    FROM book_copies WHERE copy_id = ? FOR UPDATE
  `, [reservation.copyId]);

    const copy = copies[0];
    if (!copy || copy.bookId !== reservation.bookId || copy.branchId !== reservation.branchId
        || copy.copyStatus !== expectedStatus) {
        throw fail(409, "STOCK_CONFLICT", "The reservation and copy records do not match. Ask an administrator to check them.");
    }

    const [loans] = await connection.execute(`
    SELECT loan_id FROM loans
    WHERE copy_id = ? AND return_date IS NULL FOR UPDATE
  `, [copy.copyId]);

    if (loans.length) throw fail(409, "STOCK_CONFLICT", "This copy already has an open loan.");
    return copy;
}

// The caller must hold the parent book lock before changing its holds or copies.
async function expireBookLocked(connection, bookId, now) {
    const [expired] = await connection.execute(`
    SELECT reservation_id AS reservationId, book_id AS bookId,
      branch_id AS branchId, copy_id AS copyId
    FROM reservations
    WHERE book_id = ? AND reservation_status = 'ready' AND held_until <= ?
    ORDER BY copy_id, reservation_id FOR UPDATE
  `, [bookId, now]);

    for (const reservation of expired) {
        await lockCopy(connection, reservation, "reserved");

        await connection.execute(`
      UPDATE reservations
      SET reservation_status = 'expired', closed_at = ?
      WHERE reservation_id = ?
    `, [now, reservation.reservationId]);

        await connection.execute(`
      UPDATE book_copies SET copy_status = 'available' WHERE copy_id = ?
    `, [reservation.copyId]);
    }

    return expired.length;
}

async function expireHolds() {
    const [books] = await pool.execute(`
    SELECT DISTINCT book_id AS bookId FROM reservations
    WHERE reservation_status = 'ready' AND held_until <= UTC_TIMESTAMP()
    ORDER BY book_id LIMIT 20
  `);

    let expiredCount = 0;
    for (const book of books) {
        expiredCount += await transaction(async connection => {
            await lockBook(connection, book.bookId);
            return expireBookLocked(connection, book.bookId, await clock(connection));
        });
    }

    return { expiredCount, booksProcessed: books.length };
}

async function getOptions(bookId) {
    return transaction(async connection => {
        const [books] = await connection.execute(`
      SELECT book_id AS bookId, title FROM books
      WHERE book_id = ? AND status = 'active'
    `, [bookId]);

        if (!books.length) {
            throw fail(404, "BOOK_NOT_FOUND", "The book is unavailable for reservation.");
        }

        const [branches] = await connection.execute(`
      SELECT DISTINCT br.branch_id AS branchId, br.branch_name AS branchName
      FROM branches AS br
      INNER JOIN book_copies AS bc ON bc.branch_id = br.branch_id
      WHERE bc.book_id = ? AND br.status = 'active' AND bc.copy_status <> 'inactive'
      ORDER BY br.branch_name
    `, [bookId]);

        const settings = await readPolicies(connection, { reservations: true });

        return {
            book: books[0],
            branches,
            policies: {
                holdHours: settings.holdHours,
                maxActiveReservations: settings.maxActiveReservations
            }
        };
    }, true);
}

async function rejectExistingLoan(connection, memberId, bookId) {
    const [loans] = await connection.execute(`
    SELECT l.loan_id FROM loans AS l
    INNER JOIN book_copies AS bc ON bc.copy_id = l.copy_id
    WHERE l.member_id = ? AND bc.book_id = ? AND l.return_date IS NULL
    FOR UPDATE
  `, [memberId, bookId]);

    if (loans.length) {
        throw fail(409, "ALREADY_BORROWED", "This member already has an open loan for this book.");
    }
}

async function actionResult(connection, reservationId, message) {
    const [rows] = await connection.execute(`
    SELECT reservation_id AS reservationId, reservation_status AS status,
      copy_id AS copyId, loan_id AS loanId,
      DATE_FORMAT(DATE_ADD(held_until, INTERVAL 2 HOUR), '%Y-%m-%d %H:%i') AS heldUntil
    FROM reservations WHERE reservation_id = ? FOR SHARE
  `, [reservationId]);

    return { ...rows[0], message };
}

async function reserveBook(userId, { bookId, branchId }) {
    return transaction(async connection => {
        const book = await lockBook(connection, bookId);
        if (book.status !== "active") {
            throw fail(409, "BOOK_ARCHIVED", "Archived books cannot be reserved.");
        }

        const member = await memberRecord(connection, userId, true, true);
        requireBorrowing(member);

        const now = await clock(connection);
        await expireBookLocked(connection, bookId, now);

        const [existing] = await connection.execute(`
      SELECT reservation_id AS reservationId, branch_id AS branchId
      FROM reservations
      WHERE book_id = ? AND member_id = ? AND reservation_status IN ('queued', 'ready')
      FOR UPDATE
    `, [bookId, member.memberId]);

        if (existing.length) {
            if (existing[0].branchId !== branchId) {
                throw fail(409, "ALREADY_RESERVED", "You already reserved this book at another branch. Cancel that reservation to change branches.");
            }

            return actionResult(
                connection, existing[0].reservationId,
                "This book is already reserved for you. No duplicate was created."
            );
        }

        const settings = await readPolicies(connection, { reservations: true, lock: true });

        const [active] = await connection.execute(`
      SELECT r.reservation_id FROM reservations AS r
      WHERE r.member_id = ? AND ${ACTIVE_SQL} FOR UPDATE
    `, [member.memberId, now]);

        if (active.length >= settings.maxActiveReservations) {
            throw fail(409, "RESERVATION_LIMIT", `You may have at most ${settings.maxActiveReservations} active reservations.`);
        }

        await activeBranch(connection, branchId);

        const [copies] = await connection.execute(`
      SELECT copy_id FROM book_copies
      WHERE book_id = ? AND branch_id = ? AND copy_status <> 'inactive'
      LIMIT 1 FOR SHARE
    `, [bookId, branchId]);

        if (!copies.length) {
            throw fail(409, "NO_BRANCH_STOCK", "This branch has no circulating copies of the book.");
        }

        await rejectExistingLoan(connection, member.memberId, bookId);

        const [inserted] = await connection.execute(`
      INSERT INTO reservations (book_id, member_id, branch_id, reservation_date)
      VALUES (?, ?, ?, ?)
    `, [bookId, member.memberId, branchId, now]);

        return actionResult(
            connection, inserted.insertId,
            "Reservation created. You have joined the collection branch's queue."
        );
    });
}

async function reservationContext(reservationId, userId, work) {
    return transaction(async connection => {
        const [initial] = await connection.execute(`
      SELECT r.book_id AS bookId, r.member_id AS memberId
      FROM reservations AS r
      INNER JOIN members AS m ON m.member_id = r.member_id
      WHERE r.reservation_id = ? ${userId === null ? "" : "AND m.user_id = ?"}
    `, userId === null ? [reservationId] : [reservationId, userId]);

        if (!initial.length) {
            throw fail(404, "RESERVATION_NOT_FOUND", "The reservation could not be found.");
        }

        const book = await lockBook(connection, initial[0].bookId);
        const member = userId === null
            ? await memberRecord(connection, initial[0].memberId, false, true, true)
            : await memberRecord(connection, userId, true, true);

        if (member.memberId !== initial[0].memberId) {
            throw fail(404, "RESERVATION_NOT_FOUND", "The reservation could not be found.");
        }

        const now = await clock(connection);
        await expireBookLocked(connection, book.bookId, now);

        const [rows] = await connection.execute(`
      SELECT reservation_id AS reservationId, book_id AS bookId,
        member_id AS memberId, branch_id AS branchId,
        copy_id AS copyId, loan_id AS loanId, reservation_status AS status,
        DATE_FORMAT(held_until, '%Y-%m-%d %H:%i:%s') AS heldUntilUTC
      FROM reservations WHERE reservation_id = ? FOR UPDATE
    `, [reservationId]);

        const reservation = rows[0];
        if (!reservation || reservation.bookId !== book.bookId || reservation.memberId !== member.memberId) {
            throw fail(409, "RESERVATION_CHANGED", "The reservation details changed. Refresh before trying again.");
        }

        return work(connection, { reservation, book, member, now });
    });
}

async function cancelReservation(reservationId, userId) {
    return reservationContext(reservationId, userId, async (connection, context) => {
        const { reservation, now } = context;

        if (reservation.status === "collected") {
            throw fail(409, "ALREADY_COLLECTED", "This reservation was collected. Return the book through the loan records.");
        }

        if (["cancelled", "expired"].includes(reservation.status)) {
            return actionResult(
                connection, reservationId,
                `This reservation is already ${reservation.status}.`
            );
        }

        if (reservation.status === "ready") {
            await lockCopy(connection, reservation, "reserved");

            await connection.execute(`
        UPDATE book_copies SET copy_status = 'available' WHERE copy_id = ?
      `, [reservation.copyId]);
        }

        await connection.execute(`
      UPDATE reservations SET reservation_status = 'cancelled', closed_at = ?
      WHERE reservation_id = ?
    `, [now, reservationId]);

        return actionResult(connection, reservationId, "Reservation cancelled.");
    });
}

async function cancelMyReservation(userId, reservationId) {
    if (!Number.isInteger(userId) || userId < 1) {
        throw fail(401, "SIGN_IN_REQUIRED", "Please sign in to manage your reservations.");
    }
    return cancelReservation(reservationId, userId);
}

async function cancelStaffReservation(reservationId) {
    return cancelReservation(reservationId, null);
}

async function prepareReservation(reservationId, staffId) {
    return reservationContext(reservationId, null, async (connection, context) => {
        const { reservation, member, book } = context;

        if (["ready", "expired"].includes(reservation.status)) {
            return actionResult(connection, reservationId, reservation.status === "ready"
                ? "This reservation is already ready. Its collection deadline was kept."
                : "The collection deadline has passed. The held copy has been released.");
        }

        if (reservation.status !== "queued") {
            throw fail(409, "RESERVATION_CLOSED", "This reservation is already closed.");
        }

        if (book.status !== "active") {
            throw fail(409, "BOOK_ARCHIVED", "Restore this book before preparing a reservation.");
        }

        requireBorrowing(member);
        await activeBranch(connection, reservation.branchId);
        await rejectExistingLoan(connection, member.memberId, book.bookId);

        const [queue] = await connection.execute(`
      SELECT reservation_id AS reservationId FROM reservations
      WHERE book_id = ? AND branch_id = ? AND reservation_status = 'queued'
      ORDER BY reservation_date, reservation_id LIMIT 1 FOR UPDATE
    `, [book.bookId, reservation.branchId]);

        if (!queue.length || queue[0].reservationId !== reservationId) {
            throw fail(409, "QUEUE_ORDER", "Prepare the first queued reservation at this branch before this one.");
        }

        const [copies] = await connection.execute(`
      SELECT copy_id AS copyId FROM book_copies
      WHERE book_id = ? AND branch_id = ? AND copy_status = 'available'
      ORDER BY copy_id LIMIT 1 FOR UPDATE
    `, [book.bookId, reservation.branchId]);

        if (!copies.length) {
            throw fail(409, "NO_COPY_AVAILABLE", "No copy is available at the collection branch yet.");
        }

        const copy = { ...reservation, copyId: copies[0].copyId };
        await lockCopy(connection, copy, "available");

        const settings = await readPolicies(connection, { reservations: true, lock: true });
        const readyAt = await clock(connection);

        await connection.execute(`
      UPDATE reservations
      SET reservation_status = 'ready', copy_id = ?, prepared_by = ?,
        ready_at = ?, held_until = DATE_ADD(CAST(? AS DATETIME), INTERVAL ? HOUR)
      WHERE reservation_id = ?
    `, [copy.copyId, staffId, readyAt, readyAt, settings.holdHours, reservationId]);

        await connection.execute(`
      UPDATE book_copies SET copy_status = 'reserved' WHERE copy_id = ?
    `, [copy.copyId]);

        return actionResult(connection, reservationId, "The copy is held and ready for collection.");
    });
}

async function loanResult(connection, reservation, repeated) {
    const [loans] = await connection.execute(`
    SELECT loan_id AS loanId,
      DATE_FORMAT(DATE_ADD(due_date, INTERVAL 2 HOUR), '%Y-%m-%d') AS dueDate
    FROM loans WHERE loan_id = ? AND copy_id = ? AND member_id = ? FOR SHARE
  `, [reservation.loanId, reservation.copyId, reservation.memberId]);

    if (!loans.length) {
        throw fail(409, "STOCK_CONFLICT", "The collected reservation and loan records do not match.");
    }

    return {
        reservationId: reservation.reservationId,
        status: "collected",
        ...loans[0],
        message: repeated
            ? "This reservation was already collected. No additional loan was created."
            : `Book collected. Due date: ${loans[0].dueDate}.`
    };
}

async function collectReservation(reservationId, staffId) {
    return reservationContext(reservationId, null, async (connection, context) => {
        const { reservation, member, book } = context;

        if (reservation.status === "collected") {
            return loanResult(connection, reservation, true);
        }

        if (reservation.status === "expired") {
            return actionResult(
                connection, reservationId,
                "The collection deadline has passed. No loan was created."
            );
        }

        if (reservation.status !== "ready") {
            throw fail(409, "NOT_READY", "Prepare this reservation before collection.");
        }

        if (book.status !== "active") {
            throw fail(409, "BOOK_ARCHIVED", "This book is archived and cannot be issued.");
        }

        requireBorrowing(member);
        await activeBranch(connection, reservation.branchId);

        const settings = await readPolicies(connection, { reservations: true, lock: true });

        const [loans] = await connection.execute(`
      SELECT loan_id FROM loans
      WHERE member_id = ? AND return_date IS NULL FOR UPDATE
    `, [member.memberId]);

        if (loans.length >= settings.maxActiveLoans) {
            throw fail(409, "LOAN_LIMIT", `This member has reached the limit of ${settings.maxActiveLoans} open loans.`);
        }

        await rejectExistingLoan(connection, member.memberId, book.bookId);
        await lockCopy(connection, reservation, "reserved");

        const issuedAt = await clock(connection);
        if (reservation.heldUntilUTC <= issuedAt) {
            await expireBookLocked(connection, book.bookId, issuedAt);

            return actionResult(
                connection, reservationId,
                "The collection deadline has passed. No loan was created."
            );
        }

        const [inserted] = await connection.execute(`
      INSERT INTO loans (
        copy_id, member_id, issued_by, issue_date, due_date, daily_fine_rate
      ) VALUES (?, ?, ?, ?, DATE_ADD(CAST(? AS DATETIME), INTERVAL ? DAY), ?)
    `, [reservation.copyId, member.memberId, staffId, issuedAt, issuedAt,
        settings.loanPeriodDays, settings.dailyFineRate]);

        await connection.execute(`
      UPDATE book_copies SET copy_status = 'on_loan' WHERE copy_id = ?
    `, [reservation.copyId]);

        await connection.execute(`
      UPDATE reservations
      SET reservation_status = 'collected', loan_id = ?, closed_at = ?
      WHERE reservation_id = ?
    `, [inserted.insertId, issuedAt, reservationId]);

        return loanResult(connection, { ...reservation, loanId: inserted.insertId }, false);
    });
}

function statusFilter(status, now) {
    if (status === "all") return { sql: "", values: [] };
    if (status === "active") return { sql: ACTIVE_SQL, values: [now] };

    if (status === "ready") {
        return {
            sql: "r.reservation_status = 'ready' AND r.held_until > ?",
            values: [now]
        };
    }

    if (status === "expired") {
        return {
            sql: "(r.reservation_status = 'expired' OR (r.reservation_status = 'ready' AND r.held_until <= ?))",
            values: [now]
        };
    }

    if (["queued", "collected", "cancelled"].includes(status)) {
        return { sql: "r.reservation_status = ?", values: [status] };
    }

    throw fail(400, "INVALID_FILTER", "The reservation filter is invalid.");
}

async function readList(connection, { memberId = null, status, page, search = "", branchId = null }, now) {
    if (!Number.isInteger(page) || page < 1 || page > 999999999) {
        throw fail(400, "INVALID_PAGE", "The reservation page is invalid.");
    }

    const filter = statusFilter(status, now);
    const conditions = [];
    const values = [];

    if (memberId !== null) {
        conditions.push("r.member_id = ?");
        values.push(memberId);
    }

    if (filter.sql) {
        conditions.push(`(${filter.sql})`);
        values.push(...filter.values);
    }

    if (branchId !== null) {
        conditions.push("r.branch_id = ?");
        values.push(branchId);
    }

    if (search) {
        conditions.push(`(LOCATE(?, b.title) > 0 OR LOCATE(?, m.member_number) > 0
      OR LOCATE(?, CONCAT(u.first_name, ' ', u.last_name)) > 0 OR LOCATE(?, bc.barcode) > 0)`);
        values.push(search, search, search, search);
    }

    const from = `FROM reservations AS r
    INNER JOIN books AS b ON b.book_id = r.book_id
    INNER JOIN branches AS br ON br.branch_id = r.branch_id
    INNER JOIN members AS m ON m.member_id = r.member_id
    INNER JOIN users AS u ON u.user_id = m.user_id
    LEFT JOIN book_copies AS bc ON bc.copy_id = r.copy_id`;

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

    const [counts] = await connection.execute(
        `SELECT COUNT(*) AS total ${from} ${where}`, values
    );

    const pageInfo = pagination(Number(counts[0].total), page, PAGE_SIZE);
    const offset = (pageInfo.page - 1) * PAGE_SIZE;

    const [items] = await connection.execute(`
    SELECT r.reservation_id AS reservationId, r.book_id AS bookId, b.title,
      r.branch_id AS branchId, br.branch_name AS branchName,
      m.member_number AS memberNumber, CONCAT(u.first_name, ' ', u.last_name) AS memberName,
      r.copy_id AS copyId, bc.barcode, r.loan_id AS loanId,
      CASE WHEN r.reservation_status = 'ready' AND r.held_until <= ?
        THEN 'expired' ELSE r.reservation_status END AS status,
      CASE WHEN r.reservation_status = 'queued' THEN 1 + (
        SELECT COUNT(*) FROM reservations AS q
        WHERE q.book_id = r.book_id AND q.branch_id = r.branch_id
          AND q.reservation_status = 'queued'
          AND (q.reservation_date < r.reservation_date OR (
            q.reservation_date = r.reservation_date AND q.reservation_id < r.reservation_id
          ))
      ) ELSE NULL END AS queuePosition,
      DATE_FORMAT(DATE_ADD(r.reservation_date, INTERVAL 2 HOUR), '%Y-%m-%d %H:%i') AS reservationDate,
      DATE_FORMAT(DATE_ADD(r.ready_at, INTERVAL 2 HOUR), '%Y-%m-%d %H:%i') AS readyAt,
      DATE_FORMAT(DATE_ADD(r.held_until, INTERVAL 2 HOUR), '%Y-%m-%d %H:%i') AS heldUntil,
      DATE_FORMAT(DATE_ADD(r.closed_at, INTERVAL 2 HOUR), '%Y-%m-%d %H:%i') AS closedAt
    ${from} ${where}
    ORDER BY r.reservation_date, r.reservation_id
    LIMIT ${PAGE_SIZE} OFFSET ${offset}
  `, [now, ...values]);

    return {
        items: items.map(item => ({
            ...item,
            queuePosition: item.queuePosition === null ? null : Number(item.queuePosition)
        })),
        pagination: pageInfo
    };
}

async function getMyReservations(userId, { status = "active", page = 1 } = {}) {
    return transaction(async connection => {
        const member = await memberRecord(connection, userId);

        const records = await readList(
            connection, { memberId: member.memberId, status, page }, await clock(connection)
        );

        return { userId, memberNumber: member.memberNumber, ...records };
    }, true);
}

async function getStaffReservations({ status = "active", page = 1, search = "", branchId = null } = {}) {
    return transaction(async connection => {
        return readList(connection, { status, page, search, branchId }, await clock(connection));
    }, true);
}

module.exports = {
    getOptions, reserveBook, getMyReservations, getStaffReservations,
    cancelMyReservation, cancelStaffReservation, prepareReservation,
    collectReservation, expireHolds, expireBookLocked
};