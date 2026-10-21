const express = require("express");

const {
    body,
    matchedData,
    validationResult
} = require("express-validator");

const {
    requireStaff,
    requireCsrf
} = require("../middleware/permissions");

const service = require("../services/payment-service");

const router = express.Router();

const asyncRoute = handler => (req, res, next) => {
    return Promise.resolve(handler(req, res, next)).catch(next);
};

const isId = value => typeof value === "string"
    && /^[1-9]\d{0,9}$/.test(value)
    && Number(value) <= 4294967295;

const isPage = value => typeof value === "string"
    && /^[1-9]\d{0,8}$/.test(value);

router.use((req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
});

router.use(requireStaff);

function requireJson(req, res, next) {
    if (!req.is("application/json")) {
        return res.status(415).json({
            message: "Send information as JSON."
        });
    }

    const value = req.body;

    if (
        !value
        || typeof value !== "object"
        || Array.isArray(value)
        || Object.keys(value).some(
            key => !["amount", "requestKey"].includes(key)
        )
    ) {
        return res.status(400).json({
            message: "The payment details are invalid."
        });
    }

    next();
}

function requireFineId(req, res, next) {
    if (!isId(req.params.fineId)) {
        return res.status(400).json({
            message: "The fine ID is invalid."
        });
    }

    next();
}

router.get("/", asyncRoute(async (req, res) => {
    const search = req.query.search ?? "";
    const status = req.query.status ?? "outstanding";
    const page = req.query.page ?? "1";

    if (
        Object.keys(req.query).some(
            key => !["search", "status", "page"].includes(key)
        )
        || typeof search !== "string"
        || search.length > 150
        || !["outstanding", "paid", "all"].includes(status)
        || !isPage(page)
    ) {
        return res.status(400).json({
            message: "The fine search is invalid."
        });
    }

    res.json(await service.listFines({
        search: search.trim(),
        status,
        page: Number(page)
    }));
}));

router.get(
    "/:fineId",
    requireFineId,
    asyncRoute(async (req, res) => {
        const paymentPage = req.query.paymentPage ?? "1";

        if (
            Object.keys(req.query).some(key => key !== "paymentPage")
            || !isPage(paymentPage)
        ) {
            return res.status(400).json({
                message: "The payment page is invalid."
            });
        }

        res.json(await service.getFine(
            Number(req.params.fineId),
            Number(paymentPage)
        ));
    })
);

router.post(
    "/:fineId",
    requireFineId,
    requireJson,
    requireCsrf,
    [
        body("amount")
            .isString()
            .withMessage("Enter the amount as text, such as 2.00.")
            .bail()
            .trim()
            .matches(/^(?:0|[1-9]\d{0,7})(?:\.\d{1,2})?$/)
            .withMessage("Use an amount with no more than two decimal places.")
            .bail()
            .custom(value => /[1-9]/.test(value))
            .withMessage("The payment must be greater than zero."),

        body("requestKey")
            .isString()
            .withMessage("The submission key is missing.")
            .bail()
            .trim()
            .toLowerCase()
            .matches(
                /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
            )
            .withMessage("The submission key is invalid.")
    ],
    asyncRoute(async (req, res) => {
        const errors = validationResult(req);

        if (!errors.isEmpty()) {
            return res.status(400).json({
                message: "Please check the payment details.",
                errors: errors.array({ onlyFirstError: true }).map(error => ({
                    field: error.path,
                    message: error.msg
                }))
            });
        }

        const result = await service.recordPayment(
            Number(req.params.fineId),
            matchedData(req, { locations: ["body"] }),
            req.staffUser.userId
        );

        res.status(result.replayed ? 200 : 201).json(result);
    })
);

router.use((error, req, res, next) => {
    if (res.headersSent) {
        return next(error);
    }

    if (error.status) {
        return res.status(error.status).json({
            code: error.code,
            message: error.message
        });
    }

    if (
        ["ER_LOCK_DEADLOCK", "ER_LOCK_WAIT_TIMEOUT"].includes(error.code)
    ) {
        return res.status(503).json({
            code: "PAYMENT_BUSY",
            message: "Another action is using this record. Retry the same submission shortly."
        });
    }

    if (error.code === "ER_DUP_ENTRY") {
        return res.status(409).json({
            code: "PAYMENT_CONFLICT",
            message: "The submission conflicts with another payment. Refresh and check its history."
        });
    }

    next(error);
});

module.exports = router;