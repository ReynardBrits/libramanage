const { fail } = require("./service-helpers");

async function readPolicies(connection, { lock = false, reservations = false } = {}) {
    const names = ["loan_period_days", "max_active_loans", "daily_fine_rate"];
    if (reservations) names.push("reservation_hold_hours", "max_active_reservations");

    const [rows] = await connection.execute(`
    SELECT policy_name, policy_value FROM system_policies
    WHERE policy_name IN (${names.map(() => "?").join(", ")})
    ${lock ? "FOR SHARE" : ""}
  `, names);

    const values = Object.fromEntries(
        rows.map(row => [row.policy_name, row.policy_value])
    );

    function invalid(dailyRate = false) {
        if (!reservations) {
            return Object.assign(new Error(
                "Borrowing policies are missing or invalid. Ask an administrator to check them."
            ), { status: 503 });
        }

        return fail(503, "POLICY_INVALID", dailyRate
            ? "The daily fine policy is missing or invalid."
            : "Library policies are missing or invalid. Ask an administrator to check them.");
    }

    function integer(name, maximum) {
        const value = values[name];
        if (typeof value !== "string" || !/^[1-9]\d*$/.test(value) || Number(value) > maximum) {
            throw invalid();
        }
        return Number(value);
    }

    const rate = values.daily_fine_rate;
    if (typeof rate !== "string" || !/^(0|[1-9]\d{0,3})(\.\d{1,2})?$/.test(rate) || Number(rate) > 1000) {
        throw invalid(true);
    }

    const settings = reservations ? {
        holdHours: integer("reservation_hold_hours", 720),
        maxActiveReservations: integer("max_active_reservations", 50)
    } : {};

    return {
        ...settings,
        loanPeriodDays: integer("loan_period_days", 365),
        maxActiveLoans: integer("max_active_loans", 50),
        dailyFineRate: rate
    };
}

module.exports = { readPolicies };