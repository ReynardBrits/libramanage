const { timingSafeEqual } = require("node:crypto");
const pool = require("../config/database");

// Check the user's current role in MySQL.
async function requireStaff(req, res, next) {
    const userId = req.session?.userId;

    if (!Number.isInteger(userId)) {
        return res.status(401).json({
            code: "SIGN_IN_REQUIRED",
            message: "Please sign in to manage books."
        });
    }

    try {
        const [users] = await pool.execute(
            `
                SELECT r.role_name AS roleName
                FROM users AS u
                INNER JOIN roles AS r
                    ON r.role_id = u.role_id
                WHERE u.user_id = ?
                    AND u.status = 'active'
            `,
            [userId]
        );

        if (users.length === 0) {
            return res.status(401).json({
                code: "SIGN_IN_REQUIRED",
                message: "Please sign in to manage books."
            });
        }

        if (!["admin", "librarian"].includes(users[0].roleName)) {
            return res.status(403).json({
                code: "FORBIDDEN",
                message:
                    "Only administrators and librarians can manage books."
            });
        }

        req.staffUser = {
            userId,
            roleName: users[0].roleName
        };

        next();
    } catch (error) {
        next(error);
    }
}

// Protect requests that change data.
function requireCsrf(req, res, next) {
    const expected = req.session?.csrfToken;
    const submitted = req.get("X-CSRF-Token");

    if (
        typeof expected !== "string" ||
        typeof submitted !== "string" ||
        !/^[0-9a-f]{64}$/.test(expected) ||
        !/^[0-9a-f]{64}$/.test(submitted) ||
        !timingSafeEqual(
            Buffer.from(expected),
            Buffer.from(submitted)
        )
    ) {
        return res.status(403).json({
            code: "CSRF_INVALID",
            message:
                "Your session could not be verified. Please try again."
        });
    }

    next();
}

module.exports = {
    requireStaff,
    requireCsrf
};