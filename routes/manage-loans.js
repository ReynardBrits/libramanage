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

const service = require("../services/loan-service");

const router = express.Router();

const asyncRoute = handler => (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
};

const isId = value =>
    typeof value === "string"
    && /^[1-9]\d{0,9}$/.test(value)
    && Number(value) <= 4294967295;

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

    next();
}

router.get("/options", asyncRoute(async (req, res) => {
    res.json(await service.getOptions());
}));

router.get("/copies", asyncRoute(async (req, res) => {
    const search = req.query.search ?? "";
    const branchId = req.query.branchId ?? "";

    if (
        typeof search !== "string"
        || search.length > 150
        || (branchId !== "" && !isId(branchId))
    ) {
        return res.status(400).json({
            message: "The copy search is invalid."
        });
    }

    res.json(await service.findCopies({
        search: search.trim(),
        branchId: branchId ? Number(branchId) : null
    }));
}));

router.get("/", asyncRoute(async (req, res) => {
    const search = req.query.search ?? "";
    const status = req.query.status ?? "open";
    const page = req.query.page ?? "1";

    if (
        typeof search !== "string"
        || search.length > 150
        || typeof status !== "string"
        || !["open", "overdue", "returned", "all"].includes(status)
        || typeof page !== "string"
        || !/^[1-9]\d{0,8}$/.test(page)
    ) {
        return res.status(400).json({
            message: "The loan search is invalid."
        });
    }

    res.json(await service.listLoans({
        search: search.trim(),
        status,
        page: Number(page)
    }));
}));

router.post(
    "/",
    requireJson,
    requireCsrf,
    [
        body("memberNumber")
            .isString()
            .withMessage("Enter a member number.")
            .bail()
            .trim()
            .toUpperCase()
            .matches(/^LM-\d{6,10}$/)
            .withMessage("Enter a member number such as LM-000001."),

        body("copyId")
            .custom(isId)
            .withMessage("Choose an available copy.")
            .bail()
            .toInt()
    ],
    asyncRoute(async (req, res) => {
        const errors = validationResult(req);

        if (!errors.isEmpty()) {
            return res.status(400).json({
                message: "Please check the loan details.",
                errors: errors
                    .array({ onlyFirstError: true })
                    .map(error => ({
                        field: error.path,
                        message: error.msg
                    }))
            });
        }

        const values = matchedData(req, {
            locations: ["body"]
        });

        res.status(201).json(
            await service.issueBook(values, req.staffUser.userId)
        );
    })
);

router.post(
    "/:loanId/return",
    requireJson,
    requireCsrf,
    asyncRoute(async (req, res) => {
        if (!isId(req.params.loanId)) {
            return res.status(400).json({
                message: "The loan ID is invalid."
            });
        }

        res.json(await service.returnBook(
            Number(req.params.loanId),
            req.staffUser.userId
        ));
    })
);

router.use((error, req, res, next) => {
    if (res.headersSent) {
        return next(error);
    }

    if (error.status) {
        return res.status(error.status).json({
            message: error.message
        });
    }

    if (error.code === "ER_DUP_ENTRY") {
        return res.status(409).json({
            message:
                "A loan or fine record already exists. Refresh the list before trying again."
        });
    }

    if (
        ["ER_LOCK_DEADLOCK", "ER_LOCK_WAIT_TIMEOUT"].includes(error.code)
    ) {
        return res.status(503).json({
            message:
                "Another staff action is using this record. Refresh the list and try again."
        });
    }

    next(error);
});

module.exports = router;