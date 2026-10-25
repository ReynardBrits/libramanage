const express = require("express");
const { getBorrowing } = require("../services/member-service");

const router = express.Router();

const allowedFilters = ["loanStatus", "loanPage", "finePage"];
const loanStatuses = ["all", "open", "overdue", "returned"];

const validPage = value =>
    typeof value === "string" && /^[1-9]\d{0,8}$/.test(value);

router.use((req, res, next) => {
    res.set("Cache-Control", "no-store");

    if (!Number.isInteger(req.session?.userId)) {
        return res.status(401).json({
            code: "SIGN_IN_REQUIRED",
            message: "Please sign in to view your borrowing records."
        });
    }

    next();
});

router.get("/", async (req, res, next) => {
    const loanStatus = req.query.loanStatus ?? "all";
    const loanPage = req.query.loanPage ?? "1";
    const finePage = req.query.finePage ?? "1";

    if (
        Object.keys(req.query).some(key => !allowedFilters.includes(key))
        || typeof loanStatus !== "string"
        || !loanStatuses.includes(loanStatus)
        || !validPage(loanPage)
        || !validPage(finePage)
    ) {
        return res.status(400).json({
            message: "The borrowing filters are invalid."
        });
    }

    try {
        // Use the signed-in user's identity, never a client-supplied user ID.
        const result = await getBorrowing(req.session.userId, {
            loanStatus,
            loanPage: Number(loanPage),
            finePage: Number(finePage)
        });

        res.json(result);
    } catch (error) {
        if (error.status) {
            return res.status(error.status).json({
                code: error.code,
                message: error.message
            });
        }

        next(error);
    }
});

module.exports = router;