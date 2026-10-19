const express = require("express");
const { randomBytes, scrypt } = require("node:crypto");
const { promisify } = require("node:util");
const {
    body,
    matchedData,
    validationResult
} = require("express-validator");
const { rateLimit } = require("express-rate-limit");

const pool = require("../config/database");

const router = express.Router();
const scryptAsync = promisify(scrypt);

// Limit repeated registration attempts.
const registrationLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: {
        message:
            "Too many registration attempts. Please try again in 15 minutes."
    }
});

// Create a salted password hash.
async function hashPassword(password) {
    const salt = randomBytes(16).toString("hex");

    const key = await scryptAsync(password, salt, 64, {
        N: 32768,
        r: 8,
        p: 3,
        maxmem: 64 * 1024 * 1024
    });

    return [
        "scrypt",
        32768,
        8,
        3,
        salt,
        key.toString("hex")
    ].join("$");
}

// Accept JSON requests from our registration page.
function requireJson(req, res, next) {
    if (!req.is("application/json")) {
        return res.status(415).json({
            message: "Please submit the registration form as JSON."
        });
    }

    next();
}

const registrationRules = [
    body("firstName")
        .isString()
        .withMessage("Enter your first name.")
        .bail()
        .trim()
        .isLength({ min: 1, max: 60 })
        .withMessage("First name must contain 1–60 characters."),

    body("lastName")
        .isString()
        .withMessage("Enter your last name.")
        .bail()
        .trim()
        .isLength({ min: 1, max: 60 })
        .withMessage("Last name must contain 1–60 characters."),

    body("email")
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
        .customSanitizer((value) => value.toLowerCase()),

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

// POST /api/auth/register
router.post(
    "/register",
    registrationLimiter,
    requireJson,
    registrationRules,
    async (req, res) => {
        const validation = validationResult(req);

        if (!validation.isEmpty()) {
            return res.status(400).json({
                message: "Please check the highlighted fields.",
                errors: validation
                    .array({ onlyFirstError: true })
                    .map((error) => ({
                        field: error.path,
                        message: error.msg
                    }))
            });
        }

        const {
            firstName,
            lastName,
            email,
            password
        } = matchedData(req, {
            locations: ["body"]
        });

        let connection;

        try {
            // Hash before taking a database connection.
            const passwordHash = await hashPassword(password);

            connection = await pool.getConnection();
            await connection.beginTransaction();

            // Public registration always creates a member account.
            const [roles] = await connection.execute(
                "SELECT role_id FROM roles WHERE role_name = ?",
                ["member"]
            );

            if (roles.length === 0) {
                throw new Error("The member role has not been configured.");
            }

            const [result] = await connection.execute(
                `
                    INSERT INTO users (
                        role_id,
                        first_name,
                        last_name,
                        email,
                        password_hash
                    )
                    VALUES (?, ?, ?, ?, ?)
                `,
                [
                    roles[0].role_id,
                    firstName,
                    lastName,
                    email,
                    passwordHash
                ]
            );

            const memberNumber =
                `LM-${String(result.insertId).padStart(6, "0")}`;

            await connection.execute(
                `
                    INSERT INTO members (
                        user_id,
                        member_number,
                        date_joined
                    )
                    VALUES (?, ?, CURRENT_DATE())
                `,
                [result.insertId, memberNumber]
            );

            // Save both records together.
            await connection.commit();

            res.set("Cache-Control", "no-store");

            return res.status(201).json({
                message: "Your account has been created.",
                memberNumber
            });
        } catch (error) {
            if (connection) {
                try {
                    await connection.rollback();
                } catch (rollbackError) {
                    console.error(
                        "Registration rollback failed:",
                        rollbackError.message
                    );
                }
            }

            if (error.code === "ER_DUP_ENTRY") {
                return res.status(409).json({
                    message:
                        "An account with these details already exists. Please check your email address."
                });
            }

            console.error("Registration failed:", error.message);

            return res.status(500).json({
                message:
                    "We could not create your account. Please try again."
            });
        } finally {
            if (connection) {
                connection.release();
            }
        }
    }
);

module.exports = router;