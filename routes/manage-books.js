const express = require("express");
const { body, matchedData, validationResult } = require("express-validator");
const { requireStaff, requireCsrf } = require("../middleware/permissions");
const books = require("../services/book-service");

const router = express.Router();

const asyncRoute = handler => (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
};

const validatedBody = req => matchedData(req, { locations: ["body"] });

router.use((req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
});

router.use(requireStaff);

router.param("bookId", (req, res, next, value) => {
    if (!/^[1-9]\d{0,9}$/.test(value) || Number(value) > 4294967295) {
        return res.status(400).json({ message: "Choose a valid book." });
    }

    req.bookId = Number(value);
    next();
});

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
    if (optional) rule = rule.optional({ values: "falsy" });

    return rule
        .isString()
        .withMessage("Choose a valid option.")
        .bail()
        .isInt({ min: 1, max: 4294967295 })
        .withMessage("Choose a valid option.")
        .bail()
        .toInt();
}

// Convert a validated ISBN-10 into its equivalent ISBN-13.
function toIsbn13(isbn) {
    if (isbn.length === 13) return isbn;

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
        .customSanitizer(value => value.replace(/[\s-]/g, "").toUpperCase())
        .isISBN()
        .withMessage("Enter a valid ISBN-10 or ISBN-13.")
        .bail()
        .customSanitizer(toIsbn13),

    idRule("categoryId"),
    idRule("publisherId", true),

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
        .custom(value => Number(value) <= new Date().getFullYear() + 1)
        .withMessage(
            "Publication year cannot be more than one year in the future."
        )
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

const creationRules = [
    idRule("branchId"),

    body("initialCopies")
        .isString()
        .withMessage("Enter the number of copies.")
        .bail()
        .isInt({ min: 1, max: 20 })
        .withMessage("Add between 1 and 20 copies at a time.")
        .bail()
        .toInt()
];

function rejectInvalidFields(req, res, next) {
    const validation = validationResult(req);

    if (!validation.isEmpty()) {
        return res.status(400).json({
            message: "Please check the book details.",
            errors: validation.array({ onlyFirstError: true }).map(error => ({
                field: error.path,
                message: error.msg
            }))
        });
    }

    next();
}

router.get("/options", asyncRoute(async (req, res) => {
    res.json(await books.getOptions());
}));

router.get("/", asyncRoute(async (req, res) => {
    const search = req.query.search ?? "";
    const status = req.query.status ?? "all";
    const page = req.query.page ?? "1";

    if (
        typeof search !== "string"
        || search.length > 150
        || typeof status !== "string"
        || !["all", "active", "inactive"].includes(status)
        || typeof page !== "string"
        || !/^[1-9]\d{0,8}$/.test(page)
    ) {
        return res.status(400).json({
            message: "Use valid search, status and page values."
        });
    }

    res.json(await books.listBooks({
        search: search.trim(),
        status,
        page: Number(page)
    }));
}));

router.get("/:bookId", asyncRoute(async (req, res) => {
    res.json({ book: await books.getBook(req.bookId) });
}));

router.post(
    "/",
    requireJson,
    requireCsrf,
    bookRules,
    creationRules,
    rejectInvalidFields,
    asyncRoute(async (req, res) => {
        res.status(201).json(await books.createBook(validatedBody(req)));
    })
);

router.put(
    "/:bookId",
    requireJson,
    requireCsrf,
    bookRules,
    rejectInvalidFields,
    asyncRoute(async (req, res) => {
        res.json(await books.updateBook(req.bookId, validatedBody(req)));
    })
);

router.patch(
    "/:bookId/status",
    requireJson,
    requireCsrf,

    body("status")
        .isString()
        .withMessage("Choose a valid book status.")
        .bail()
        .isIn(["active", "inactive"])
        .withMessage("Choose a valid book status."),

    rejectInvalidFields,

    asyncRoute(async (req, res) => {
        const { status } = validatedBody(req);
        res.json(await books.setBookStatus(req.bookId, status));
    })
);

router.use((error, req, res, next) => {
    if (res.headersSent) return next(error);

    if (error.status) {
        return res.status(error.status).json({ message: error.message });
    }

    if (error.code === "ER_DUP_ENTRY") {
        return res.status(409).json({
            message: "A book with this ISBN already exists."
        });
    }

    next(error);
});

module.exports = router;