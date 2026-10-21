const { fail, pagination, transaction } = require("../utils/service-helpers");

const PAGE_SIZE = 10;

async function getBorrowing(userId, options) {
    return transaction(async connection => {
        const [members] = await connection.execute(`
      SELECT m.member_id AS memberId, m.member_number AS memberNumber,
        m.borrowing_status AS borrowingStatus,
        DATE_FORMAT(
          DATE_ADD(UTC_TIMESTAMP(), INTERVAL 2 HOUR), '%Y-%m-%d'
        ) AS today
      FROM users AS u
      LEFT JOIN members AS m ON m.user_id = u.user_id
      WHERE u.user_id = ? AND u.status = 'active'
    `, [userId]);

        if (!members.length) {
            throw fail(
                401, "SIGN_IN_REQUIRED",
                "Please sign in to view your borrowing records."
            );
        }

        const member = members[0];

        if (member.memberId === null) {
            throw fail(
                403, "MEMBERSHIP_REQUIRED",
                "This account does not have a library membership."
            );
        }

        const overdue = "DATE(DATE_ADD(l.due_date, INTERVAL 2 HOUR)) < ?";

        const [loanTotals] = await connection.execute(`
      SELECT COUNT(*) AS totalLoans,
        COALESCE(SUM(l.return_date IS NULL), 0) AS openLoans,
        COALESCE(SUM(
          l.return_date IS NULL AND ${overdue}
        ), 0) AS overdueLoans
      FROM loans AS l
      WHERE l.member_id = ?
    `, [member.today, member.memberId]);

        const [fineTotals] = await connection.execute(`
      SELECT COUNT(*) AS totalFines,
        COALESCE(SUM(GREATEST(
          f.amount - COALESCE((
            SELECT SUM(p.amount)
            FROM payments AS p
            WHERE p.fine_id = f.fine_id
          ), 0.00), 0.00
        )), 0.00) AS outstandingBalance
      FROM fines AS f
      INNER JOIN loans AS l ON l.loan_id = f.loan_id
      WHERE l.member_id = ?
    `, [member.memberId]);

        const summary = {
            totalLoans: Number(loanTotals[0].totalLoans),
            openLoans: Number(loanTotals[0].openLoans),
            overdueLoans: Number(loanTotals[0].overdueLoans),
            outstandingBalance: fineTotals[0].outstandingBalance
        };

        const totals = {
            all: summary.totalLoans,
            open: summary.openLoans,
            overdue: summary.overdueLoans,
            returned: summary.totalLoans - summary.openLoans
        };

        const loanPagination = pagination(
            totals[options.loanStatus], options.loanPage
        );

        const finePagination = pagination(
            Number(fineTotals[0].totalFines), options.finePage
        );

        const conditions = ["l.member_id = ?"];
        const parameters = [member.memberId];

        if (options.loanStatus === "open") {
            conditions.push("l.return_date IS NULL");
        }

        if (options.loanStatus === "returned") {
            conditions.push("l.return_date IS NOT NULL");
        }

        if (options.loanStatus === "overdue") {
            conditions.push("l.return_date IS NULL", overdue);
            parameters.push(member.today);
        }

        const [loans] = await connection.execute(`
      SELECT l.loan_id AS loanId, b.title, bc.barcode,
        br.branch_name AS branchName,
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
          COALESCE(DATE_ADD(l.return_date, INTERVAL 2 HOUR), ?),
          DATE_ADD(l.due_date, INTERVAL 2 HOUR)
        ), 0) * l.daily_fine_rate, 2) AS estimatedFine,
        COALESCE(f.amount, 0.00) AS fineAmount
      FROM loans AS l
      INNER JOIN book_copies AS bc ON bc.copy_id = l.copy_id
      INNER JOIN books AS b ON b.book_id = bc.book_id
      INNER JOIN branches AS br ON br.branch_id = bc.branch_id
      LEFT JOIN fines AS f ON f.loan_id = l.loan_id
      WHERE ${conditions.join(" AND ")}
      ORDER BY l.loan_id DESC
      LIMIT ${PAGE_SIZE} OFFSET ${(loanPagination.page - 1) * PAGE_SIZE}
    `, [member.today, member.today, ...parameters]);

        const [fines] = await connection.execute(`
      SELECT records.*,
        GREATEST(records.fineAmount - records.paidAmount, 0.00) AS balance,
        CASE
          WHEN records.paidAmount >= records.fineAmount THEN 'paid'
          WHEN records.paidAmount > 0 THEN 'partially_paid'
          ELSE 'unpaid'
        END AS status
      FROM (
        SELECT f.fine_id AS fineId, b.title,
          f.overdue_days AS overdueDays, f.amount AS fineAmount,
          COALESCE((
            SELECT SUM(p.amount)
            FROM payments AS p
            WHERE p.fine_id = f.fine_id
          ), 0.00) AS paidAmount
        FROM fines AS f
        INNER JOIN loans AS l ON l.loan_id = f.loan_id
        INNER JOIN book_copies AS bc ON bc.copy_id = l.copy_id
        INNER JOIN books AS b ON b.book_id = bc.book_id
        WHERE l.member_id = ?
        ORDER BY f.fine_id DESC
        LIMIT ${PAGE_SIZE} OFFSET ${(finePagination.page - 1) * PAGE_SIZE}
      ) AS records
      ORDER BY records.fineId DESC
    `, [member.memberId]);

        return {
            userId,
            membership: {
                memberNumber: member.memberNumber,
                borrowingStatus: member.borrowingStatus
            },
            summary,
            loans: { items: loans, pagination: loanPagination },
            fines: { items: fines, pagination: finePagination }
        };
    }, true);
}

module.exports = { getBorrowing };