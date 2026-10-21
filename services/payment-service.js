const pool = require("../config/database");

const PAGE_SIZE = 10;

const PAID_SQL = `COALESCE((
  SELECT SUM(p.amount)
  FROM payments AS p
  WHERE p.fine_id = f.fine_id
), 0.00)`;

const FINE_FROM = `
  FROM fines AS f
  INNER JOIN loans AS l ON l.loan_id = f.loan_id
  INNER JOIN members AS m ON m.member_id = l.member_id
  INNER JOIN users AS u ON u.user_id = m.user_id
  INNER JOIN book_copies AS bc ON bc.copy_id = l.copy_id
  INNER JOIN books AS b ON b.book_id = bc.book_id
`;

const FINE_SELECT = `
  SELECT
    f.fine_id AS fineId,
    f.loan_id AS loanId,
    m.member_number AS memberNumber,
    CONCAT(u.first_name, ' ', u.last_name) AS memberName,
    b.title,
    bc.barcode,
    f.overdue_days AS overdueDays,
    f.amount AS fineAmount,
    ${PAID_SQL} AS paidAmount,
    DATE_FORMAT(
      DATE_ADD(f.created_at, INTERVAL 2 HOUR),
      '%Y-%m-%d %H:%i'
    ) AS createdAt
  ${FINE_FROM}
`;

function fail(status, code, message) {
    return Object.assign(new Error(message), { status, code });
}

// Calculate money as integer cents, avoiding floating-point rounding.
function toCents(value) {
    const match = /^(0|[1-9]\d*)(?:\.(\d{1,2}))?$/.exec(String(value));

    if (!match) {
        throw new Error("Invalid money value.");
    }

    return BigInt(match[1]) * 100n
        + BigInt((match[2] || "").padEnd(2, "0"));
}

function money(cents) {
    return `${cents / 100n}.${String(cents % 100n).padStart(2, "0")}`;
}

function describeFine(row) {
    const charged = toCents(row.fineAmount);
    const paid = toCents(row.paidAmount);
    const balance = charged > paid ? charged - paid : 0n;

    return {
        ...row,
        fineAmount: money(charged),
        paidAmount: money(paid),
        balance: money(balance),
        status: balance === 0n ? "paid" : paid > 0n ? "partially_paid" : "unpaid"
    };
}

async function transaction(work, readOnly = false) {
    const connection = await pool.getConnection();
    let started = false;

    try {
        if (readOnly) {
            await connection.query(
                "START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY"
            );
        } else {
            await connection.beginTransaction();
        }

        started = true;

        const result = await work(connection);

        await connection.commit();

        return result;
    } catch (error) {
        if (started) {
            await connection.rollback();
        }

        throw error;
    } finally {
        connection.release();
    }
}

function pagination(total, requestedPage) {
    const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

    return {
        page: Math.min(requestedPage, pageCount),
        pageCount,
        pageSize: PAGE_SIZE,
        total
    };
}

async function listFines({ search, status, page }) {
    return transaction(async connection => {
        const conditions = [];
        const values = [];

        if (search) {
            conditions.push(`(
        LOCATE(?, m.member_number) > 0
        OR LOCATE(?, CONCAT(u.first_name, ' ', u.last_name)) > 0
        OR LOCATE(?, b.title) > 0
        OR LOCATE(?, bc.barcode) > 0
      )`);

            values.push(search, search, search, search);
        }

        if (status === "outstanding") {
            conditions.push(`f.amount > ${PAID_SQL}`);
        } else if (status === "paid") {
            conditions.push(`f.amount <= ${PAID_SQL}`);
        }

        const where = conditions.length
            ? `WHERE ${conditions.join(" AND ")}`
            : "";

        const [counts] = await connection.execute(`
      SELECT COUNT(*) AS total
      ${FINE_FROM}
      ${where}
    `, values);

        const paging = pagination(Number(counts[0].total), page);
        const offset = (paging.page - 1) * PAGE_SIZE;

        const [rows] = await connection.execute(`
      ${FINE_SELECT}
      ${where}
      ORDER BY f.created_at DESC, f.fine_id DESC
      LIMIT ${PAGE_SIZE} OFFSET ${offset}
    `, values);

        return {
            items: rows.map(describeFine),
            pagination: paging
        };
    }, true);
}

async function getFine(fineId, paymentPage) {
    return transaction(async connection => {
        const [rows] = await connection.execute(`
      ${FINE_SELECT}
      WHERE f.fine_id = ?
    `, [fineId]);

        if (!rows.length) {
            throw fail(
                404,
                "FINE_NOT_FOUND",
                "The fine could not be found."
            );
        }

        const [counts] = await connection.execute(`
      SELECT COUNT(*) AS total
      FROM payments
      WHERE fine_id = ?
    `, [fineId]);

        const paging = pagination(Number(counts[0].total), paymentPage);
        const offset = (paging.page - 1) * PAGE_SIZE;

        const [payments] = await connection.execute(`
      SELECT
        p.payment_id AS paymentId,
        p.amount,
        DATE_FORMAT(
          DATE_ADD(p.payment_date, INTERVAL 2 HOUR),
          '%Y-%m-%d %H:%i'
        ) AS paymentDate,
        CONCAT(u.first_name, ' ', u.last_name) AS recordedByName
      FROM payments AS p
      INNER JOIN users AS u ON u.user_id = p.recorded_by
      WHERE p.fine_id = ?
      ORDER BY p.payment_id DESC
      LIMIT ${PAGE_SIZE} OFFSET ${offset}
    `, [fineId]);

        return {
            fine: describeFine(rows[0]),
            payments: {
                items: payments,
                pagination: paging
            }
        };
    }, true);
}

function paymentResult(payment, fineAmount, paidAmount, replayed) {
    const charged = toCents(fineAmount);
    const paidAtReceipt = toCents(paidAmount);

    const balance = charged > paidAtReceipt
        ? charged - paidAtReceipt
        : 0n;

    return {
        replayed,
        message: replayed
            ? "This submission was already recorded. The original receipt is shown."
            : "Payment recorded successfully.",
        receipt: {
            ...payment,
            amount: money(toCents(payment.amount)),
            balanceAfterPayment: money(balance)
        }
    };
}

async function recordAttempt(fineId, amount, requestKey, staffId) {
    return transaction(async connection => {
        // All payment writers lock the fine before checking its balance.
        const [fines] = await connection.execute(`
      SELECT fine_id AS fineId, amount AS fineAmount
      FROM fines
      WHERE fine_id = ?
      FOR UPDATE
    `, [fineId]);

        if (!fines.length) {
            throw fail(
                404,
                "FINE_NOT_FOUND",
                "The fine could not be found."
            );
        }

        // This first snapshot read happens after the fine lock is acquired.
        const [existing] = await connection.execute(`
      SELECT
        p.payment_id AS paymentId,
        p.fine_id AS fineId,
        p.recorded_by AS recordedBy,
        p.amount,
        DATE_FORMAT(
          DATE_ADD(p.payment_date, INTERVAL 2 HOUR),
          '%Y-%m-%d %H:%i'
        ) AS paymentDate
      FROM payment_requests AS pr
      INNER JOIN payments AS p ON p.payment_id = pr.payment_id
      WHERE pr.request_key = ?
    `, [requestKey]);

        const previous = existing[0];

        if (previous && (
            previous.fineId !== fineId
            || previous.recordedBy !== staffId
            || toCents(previous.amount) !== toCents(amount)
        )) {
            throw fail(
                409,
                "REQUEST_KEY_REUSED",
                "This submission key belongs to different payment details."
            );
        }

        if (previous) {
            const [totals] = await connection.execute(`
        SELECT COALESCE(SUM(amount), 0.00) AS paidAmount
        FROM payments
        WHERE fine_id = ? AND payment_id <= ?
      `, [fineId, previous.paymentId]);

            return paymentResult(
                previous,
                fines[0].fineAmount,
                totals[0].paidAmount,
                true
            );
        }

        // The snapshot began after the fine lock. Other payment writers must wait
        // for that lock, so this total remains stable until we commit or roll back.
        const [totals] = await connection.execute(`
      SELECT COALESCE(SUM(amount), 0.00) AS paidAmount
      FROM payments
      WHERE fine_id = ?
    `, [fineId]);

        const charged = toCents(fines[0].fineAmount);
        const paid = toCents(totals[0].paidAmount);
        const balance = charged > paid ? charged - paid : 0n;
        const submitted = toCents(amount);

        if (submitted > balance) {
            throw fail(
                409,
                "BALANCE_CHANGED",
                `The outstanding balance is R${money(balance)}. Refresh the fine before paying.`
            );
        }

        const [inserted] = await connection.execute(`
      INSERT INTO payments (
        fine_id,
        recorded_by,
        amount,
        payment_date
      )
      VALUES (?, ?, ?, UTC_TIMESTAMP())
    `, [fineId, staffId, amount]);

        await connection.execute(`
      INSERT INTO payment_requests (
        request_key,
        payment_id,
        created_at
      )
      VALUES (?, ?, UTC_TIMESTAMP())
    `, [requestKey, inserted.insertId]);

        await connection.execute(`
      UPDATE fines
      SET fine_status = ?
      WHERE fine_id = ?
    `, [
            submitted === balance ? "paid" : "partially_paid",
            fineId
        ]);

        const [receipt] = await connection.execute(`
      SELECT
        payment_id AS paymentId,
        fine_id AS fineId,
        recorded_by AS recordedBy,
        amount,
        DATE_FORMAT(
          DATE_ADD(payment_date, INTERVAL 2 HOUR),
          '%Y-%m-%d %H:%i'
        ) AS paymentDate
      FROM payments
      WHERE payment_id = ?
    `, [inserted.insertId]);

        return paymentResult(
            receipt[0],
            fines[0].fineAmount,
            money(paid + submitted),
            false
        );
    });
}

async function recordPayment(fineId, data, staffId) {
    const cents = toCents(data.amount);

    if (cents < 1n || cents > 9999999999n) {
        throw fail(
            400,
            "INVALID_AMOUNT",
            "Enter a valid payment greater than zero."
        );
    }

    const amount = money(cents);

    try {
        return await recordAttempt(
            fineId,
            amount,
            data.requestKey,
            staffId
        );
    } catch (error) {
        if (error.code !== "ER_DUP_ENTRY") {
            throw error;
        }

        // A concurrent use of the same key lost the insert race. Its transaction
        // has rolled back; start a fresh one to read or reject the saved request.
        return recordAttempt(
            fineId,
            amount,
            data.requestKey,
            staffId
        );
    }
}

module.exports = {
    listFines,
    getFine,
    recordPayment
};