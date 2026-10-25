const express = require("express");
const { randomBytes, timingSafeEqual } = require("node:crypto");
const { promisify } = require("node:util");
const { body, matchedData, validationResult } = require("express-validator");
const { rateLimit } = require("express-rate-limit");
const pool = require("../config/database");
const { hashPassword, verifyPassword } = require("../utils/passwords");
const { sessionCookieName, sessionCookieOptions } = require("../config/session");

const router = express.Router();

const validatedBody = req => matchedData(req, { locations: ["body"] });

const sessionAction = (req, action) =>
    promisify(req.session[action]).call(req.session);

const asyncRoute = handler => (req, res, next) =>
    Promise.resolve(handler(req, res, next)).catch(next);

router.use((req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
});

const limiterOptions = {
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: "draft-8",
    legacyHeaders: false
};

const registrationLimiter = rateLimit({
    ...limiterOptions,
    message: {
        message: "Too many registration attempts. Please try again in 15 minutes."
    }
});

const loginLimiter = rateLimit({
    ...limiterOptions,
    skipSuccessfulRequests: true,
    message: {
        message: "Too many unsuccessful sign-in attempts. Please try again in 15 minutes."
    }
});

function requireJson(req, res, next) {
    if (!req.is("application/json")) {
        return res.status(415).json({
            message: "Please submit the form as JSON."
        });
    }

    next();
}

function nameRule(field, label) {
    return body(field)
        .isString()
        .withMessage(`Enter your ${label.toLowerCase()}.`)
        .bail()
        .trim()
        .isLength({ min: 1, max: 60 })
        .withMessage(`${label} must contain 1–60 characters.`);
}

function emailRule() {
    return body("email")
        .isString()
        .withMessage("Enter a valid email address.")
        .bail()
        .trim()
        .isLength({ min: 3, max: 150 })
        .withMessage("Email must contain no more than 150 characters.")
        .bail()
        .isEmail()
        .withMessage("Enter a valid email address.")
        .bail()
        .customSanitizer(value => value.toLowerCase());
}

const registrationRules = [
    nameRule("firstName", "First name"),
    nameRule("lastName", "Last name"),
    emailRule(),

    body("password")
        .isString()
        .withMessage("Enter a password.")
        .bail()
        .isLength({ min: 15, max: 128 })
        .withMessage("Use a password containing 15–128 characters."),

    body("confirmPassword")
        .isString()
        .withMessage("Confirm your password.")
        .bail()
        .custom((value, { req }) => value === req.body.password)
        .withMessage("Your passwords must match.")
];

const loginRules = [
    emailRule(),

    body("password")
        .isString()
        .withMessage("Enter your password.")
        .bail()
        .isLength({ min: 1, max: 128 })
        .withMessage("Enter your password.")
];

function rejectInvalidFields(req, res, next) {
    const validation = validationResult(req);

    if (!validation.isEmpty()) {
        return res.status(400).json({
            message: "Please check the submitted fields.",
            errors: validation.array({ onlyFirstError: true }).map(error => ({
                field: error.path,
                message: error.msg
            }))
        });
    }

    next();
}

function requireCsrf(req, res, next) {
    const expected = req.session.csrfToken;
    const submitted = req.get("X-CSRF-Token");

    if (
        typeof expected !== "string"
        || typeof submitted !== "string"
        || !/^[0-9a-f]{64}$/.test(expected)
        || !/^[0-9a-f]{64}$/.test(submitted)
        || !timingSafeEqual(Buffer.from(expected), Buffer.from(submitted))
    ) {
        return res.status(403).json({
            message: "Your session could not be verified. Please try again."
        });
    }

    next();
}

// Return account details without exposing the password hash.
async function findPublicUser(userId) {
    const [users] = await pool.execute(`
    SELECT
      u.user_id AS userId,
      u.first_name AS firstName,
      u.last_name AS lastName,
      u.email,
      r.role_name AS roleName,
      m.member_number AS memberNumber,
      m.borrowing_status AS borrowingStatus
    FROM users AS u
    INNER JOIN roles AS r ON r.role_id = u.role_id
    LEFT JOIN members AS m ON m.user_id = u.user_id
    WHERE u.user_id = ? AND u.status = 'active'
  `, [userId]);

    return users[0] || null;
}

async function destroySession(req, res) {
    await sessionAction(req, "destroy");
    res.clearCookie(sessionCookieName, sessionCookieOptions);
}

router.get("/csrf-token", asyncRoute(async (req, res) => {
    if (!req.session.csrfToken) {
        req.session.csrfToken = randomBytes(32).toString("hex");
        await sessionAction(req, "save");
    }

    res.json({ csrfToken: req.session.csrfToken });
}));

router.post(
    "/register",
    registrationLimiter,
    requireJson,
    registrationRules,
    rejectInvalidFields,
    async (req, res) => {
        const { firstName, lastName, email, password } = validatedBody(req);
        let connection;

        try {
            const passwordHash = await hashPassword(password);

            connection = await pool.getConnection();
            await connection.beginTransaction();

            const [roles] = await connection.execute(
                "SELECT role_id FROM roles WHERE role_name = ?",
                ["member"]
            );

            if (!roles.length) {
                throw new Error("The member role has not been configured.");
            }

            const [result] = await connection.execute(`
        INSERT INTO users (
          role_id, first_name, last_name, email, password_hash
        )
        VALUES (?, ?, ?, ?, ?)
      `, [roles[0].role_id, firstName, lastName, email, passwordHash]);

            const memberNumber = `LM-${String(result.insertId).padStart(6, "0")}`;

            await connection.execute(`
        INSERT INTO members (user_id, member_number, date_joined)
        VALUES (?, ?, CURRENT_DATE())
      `, [result.insertId, memberNumber]);

            await connection.commit();

            return res.status(201).json({
                message: "Your account has been created.",
                memberNumber
            });
        } catch (error) {
            if (connection) {
                try {
                    await connection.rollback();
                } catch (rollbackError) {
                    console.error("Registration rollback failed:", rollbackError.message);
                }
            }

            if (error.code === "ER_DUP_ENTRY") {
                return res.status(409).json({
                    message: "An account with these details already exists. Please check your email address."
                });
            }

            console.error("Registration failed:", error.message);

            return res.status(500).json({
                message: "We could not create your account. Please try again."
            });
        } finally {
            if (connection) connection.release();
        }
    }
);

router.post(
    "/login",
    requireJson,
    requireCsrf,
    loginLimiter,
    loginRules,
    rejectInvalidFields,
    asyncRoute(async (req, res) => {
        const { email, password } = validatedBody(req);

        const [users] = await pool.execute(`
      SELECT user_id AS userId, password_hash AS passwordHash, status
      FROM users WHERE email = ?
    `, [email]);

        const user = users[0];
        let passwordMatches = false;

        if (user) {
            passwordMatches = await verifyPassword(password, user.passwordHash);
        } else {
            // Keep an unknown email check similarly expensive.
            await hashPassword(password);
        }

        if (!user || !passwordMatches || user.status !== "active") {
            return res.status(401).json({
                message: "The email address or password is incorrect."
            });
        }

        const publicUser = await findPublicUser(user.userId);

        if (!publicUser) {
            return res.status(401).json({
                message: "The email address or password is incorrect."
            });
        }

        // Replace the old session ID before assigning the authenticated user.
        await sessionAction(req, "regenerate");

        req.session.userId = user.userId;
        req.session.csrfToken = randomBytes(32).toString("hex");

        await sessionAction(req, "save");

        return res.json({
            user: publicUser,
            csrfToken: req.session.csrfToken
        });
    })
);

router.get("/me", asyncRoute(async (req, res) => {
    if (!Number.isInteger(req.session.userId)) {
        return res.status(401).json({
            message: "Please sign in to continue."
        });
    }

    const user = await findPublicUser(req.session.userId);

    if (!user) {
        await destroySession(req, res);

        return res.status(401).json({
            message: "Please sign in to continue."
        });
    }

    return res.json({ user });
}));

router.post(
    "/logout",
    requireJson,
    requireCsrf,
    asyncRoute(async (req, res) => {
        await destroySession(req, res);
        return res.json({ message: "You have been signed out." });
    })
);

module.exports = router;