const express = require("express");
const { randomUUID } = require("node:crypto");

const {
    body,
    matchedData,
    validationResult
} = require("express-validator");

const pool = require("../config/database");

const {
    requireStaff,
    requireCsrf
} = require("../middleware/permissions");

const router = express.Router();

router.use((req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
});

// Every endpoint in this router requires staff access.
router.use(requireStaff);

function requireJson(req, res, next) {
    if (!req.is("application/json")) {
        return res.status(415).json({
            message: "Please submit the book details as JSON."
        });
    }

    next();
}

function idRule(field, optional = false) {
    let rule = body(field);

    if (optional) {
        rule = rule.optional({ values: "falsy" });
    }

    return rule
        .isString()
        .withMessage("Choose a valid option.")
        .bail()
        .isInt({ min: 1, max: 4294967295 })
        .withMessage("Choose a valid option.")
        .bail()
        .toInt();
}

// Save valid ISBN-10 entries in their equivalent ISBN-13 format.
function toIsbn13(isbn) {
    if (isbn.length === 13) {
        return isbn;
    }

    const base = "978" + isbn.slice(0, 9);

    const sum = [...base].reduce(
        (total, digit, index) =>
            total + Number(digit) * (index % 2 === 0 ? 1 : 3),
        0
    );

    return base + ((10 - (sum % 10)) % 10);
}

const bookRules = [
    body("title")
        .isString()
        .withMessage("Enter a book title.")
        .bail()
        .trim()
        .isLength({ min: 1, max: 255 })
        .withMessage("Title must contain 1–255 characters."),

    body("isbn")
        .isString()
        .withMessage("Enter a valid ISBN.")
        .bail()
        .trim()
        .isLength({ min: 10, max: 20 })
        .withMessage("Enter a valid ISBN.")
        .bail()
        .customSanitizer((value) =>
            value.replace(/[\s-]/g, "").toUpperCase()
        )
        .isISBN()
        .withMessage("Enter a valid ISBN-10 or ISBN-13.")
        .bail()
        .customSanitizer(toIsbn13),

    idRule("categoryId"),
    idRule("publisherId", true),
    idRule("branchId"),

    body("authorIds")
        .isArray({ min: 1, max: 10 })
        .withMessage("Select between 1 and 10 authors."),

    idRule("authorIds.*"),

    body("publicationYear")
        .optional({ values: "falsy" })
        .isString()
        .withMessage("Enter a valid publication year.")
        .bail()
        .isInt({ min: 1, max: 65535 })
        .withMessage("Enter a valid publication year.")
        .bail()
        .custom((value) =>
            Number(value) <= new Date().getFullYear() + 1
        )
        .withMessage(
            "Publication year cannot be more than one year in the future."
        )
        .bail()
        .toInt(),

    body("initialCopies")
        .isString()
        .withMessage("Enter the number of copies.")
        .bail()
        .isInt({ min: 1, max: 20 })
        .withMessage("Add between 1 and 20 copies at a time.")
        .bail()
        .toInt(),

    body("description")
        .optional({ values: "falsy" })
        .isString()
        .withMessage("Description must be text.")
        .bail()
        .trim()
        .isLength({ max: 5000 })
        .withMessage("Description must not exceed 5,000 characters.")
];

function invalidSelection(message) {
    const error = new Error(message);
    error.status = 400;
    return error;
}

// GET /api/manage/books/options
router.get("/options", async (req, res, next) => {
    try {
        const [
            [categories],
            [publishers],
            [authors],
            [branches]
        ] = await Promise.all([
            pool.execute(`
                SELECT
                    category_id AS id,
                    category_name AS name
                FROM categories
                ORDER BY category_name
            `),

            pool.execute(`
                SELECT
                    publisher_id AS id,
                    publisher_name AS name
                FROM publishers
                ORDER BY publisher_name
            `),

            pool.execute(`
                SELECT
                    author_id AS id,
                    CONCAT_WS(' ', first_name, last_name) AS name
                FROM authors
                ORDER BY last_name, first_name
            `),

            pool.execute(`
                SELECT
                    branch_id AS id,
                    branch_name AS name
                FROM branches
                WHERE status = 'active'
                ORDER BY branch_name
            `)
        ]);

        res.json({
            categories,
            publishers,
            authors,
            branches
        });
    } catch (error) {
        next(error);
    }
});

// POST /api/manage/books
router.post(
    "/",
    requireJson,
    requireCsrf,
    bookRules,
    async (req, res, next) => {
        const validation = validationResult(req);

        if (!validation.isEmpty()) {
            return res.status(400).json({
                message: "Please check the book details.",
                errors: validation
                    .array({ onlyFirstError: true })
                    .map((error) => ({
                        field: error.path,
                        message: error.msg
                    }))
            });
        }

        const values = matchedData(req, {
            locations: ["body"]
        });

        const authorIds = [
            ...new Set(values.authorIds.map(Number))
        ];

        let connection;
        let transactionStarted = false;

        try {
            connection = await pool.getConnection();

            await connection.beginTransaction();
            transactionStarted = true;

            // Keep the selected reference records valid during this save.
            const [branches] = await connection.execute(
                `
                    SELECT branch_id
                    FROM branches
                    WHERE branch_id = ?
                        AND status = 'active'
                    FOR SHARE
                `,
                [values.branchId]
            );

            if (branches.length !== 1) {
                throw invalidSelection("Choose an active library branch.");
            }

            const [categories] = await connection.execute(
                `
                    SELECT category_id
                    FROM categories
                    WHERE category_id = ?
                    FOR SHARE
                `,
                [values.categoryId]
            );

            if (categories.length !== 1) {
                throw invalidSelection("Choose a category from the list.");
            }

            if (values.publisherId) {
                const [publishers] = await connection.execute(
                    `
                        SELECT publisher_id
                        FROM publishers
                        WHERE publisher_id = ?
                        FOR SHARE
                    `,
                    [values.publisherId]
                );

                if (publishers.length !== 1) {
                    throw invalidSelection(
                        "Choose a publisher from the list."
                    );
                }
            }

            const authorPlaceholders =
                authorIds.map(() => "?").join(", ");

            const [authors] = await connection.execute(
                `
                    SELECT author_id
                    FROM authors
                    WHERE author_id IN (${authorPlaceholders})
                    FOR SHARE
                `,
                authorIds
            );

            if (authors.length !== authorIds.length) {
                throw invalidSelection(
                    "Choose authors from the available list."
                );
            }

            const [bookResult] = await connection.execute(
                `
                    INSERT INTO books (
                        publisher_id,
                        category_id,
                        isbn,
                        title,
                        publication_year,
                        description
                    )
                    VALUES (?, ?, ?, ?, ?, ?)
                `,
                [
                    values.publisherId || null,
                    values.categoryId,
                    values.isbn,
                    values.title,
                    values.publicationYear || null,
                    values.description || null
                ]
            );

            const bookId = bookResult.insertId;

            const authorRows =
                authorIds.map(() => "(?, ?)").join(", ");

            await connection.execute(
                `
                    INSERT INTO book_authors (book_id, author_id)
                    VALUES ${authorRows}
                `,
                authorIds.flatMap((authorId) => [bookId, authorId])
            );

            const copyRows = [];
            const copyParameters = [];

            for (let index = 0; index < values.initialCopies; index++) {
                copyRows.push("(?, ?, ?, CURRENT_DATE())");

                copyParameters.push(
                    bookId,
                    values.branchId,
                    `LM-${randomUUID()}`
                );
            }

            await connection.execute(
                `
                    INSERT INTO book_copies (
                        book_id,
                        branch_id,
                        barcode,
                        acquired_date
                    )
                    VALUES ${copyRows.join(", ")}
                `,
                copyParameters
            );

            await connection.commit();
            transactionStarted = false;

            const ending = values.initialCopies === 1
                ? "copy"
                : "copies";

            return res.status(201).json({
                message:
                    `Book added with ${values.initialCopies} ${ending}.`,
                bookId,
                copyCount: values.initialCopies
            });
        } catch (error) {
            if (connection && transactionStarted) {
                try {
                    await connection.rollback();
                } catch (rollbackError) {
                    console.error(
                        "Book rollback failed:",
                        rollbackError.message
                    );
                }
            }

            if (error.status === 400) {
                return res.status(400).json({
                    message: error.message
                });
            }

            if (error.code === "ER_DUP_ENTRY") {
                return res.status(409).json({
                    message: "A book with this ISBN already exists."
                });
            }

            next(error);
        } finally {
            if (connection) {
                connection.release();
            }
        }
    }
);

module.exports = router;