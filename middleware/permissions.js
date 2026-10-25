const { timingSafeEqual } = require("node:crypto");
const pool = require("../config/database");

function signInRequired(res) {
    return res.status(401).json({
        code: "SIGN_IN_REQUIRED",
        message: "Please sign in to manage library records."
    });
}

async function requireStaff(req, res, next) {
    const userId = req.session?.userId;

    if (!Number.isInteger(userId)) {
        return signInRequired(res);
    }

    try {
        const [users] = await pool.execute(`
        SELECT r.role_name AS roleName
        FROM users AS u
        INNER JOIN roles AS r ON r.role_id = u.role_id
        WHERE u.user_id = ? AND u.status = 'active'
    `, [userId]);

        if (!users.length) {
            return signInRequired(res);
        }

        const { roleName } = users[0];

        if (!["admin", "librarian"].includes(roleName)) {
            return res.status(403).json({
                code: "FORBIDDEN",
                message:
                    "Only administrators and librarians can manage library records."
            });
        }

        req.staffUser = { userId, roleName };
        next();
    } catch (error) {
        next(error);
    }
}

function requireCsrf(req, res, next) {
    const expected = req.session?.csrfToken;
    const submitted = req.get("X-CSRF-Token");

    if (
        typeof expected !== "string"
        || typeof submitted !== "string"
        || !/^[0-9a-f]{64}$/.test(expected)
        || !/^[0-9a-f]{64}$/.test(submitted)
        || !timingSafeEqual(
            Buffer.from(expected),
            Buffer.from(submitted)
        )
    ) {
        return res.status(403).json({
            code: "CSRF_INVALID",
            message: "Your session could not be verified. Please try again."
        });
    }

    next();
}

module.exports = { requireStaff, requireCsrf };