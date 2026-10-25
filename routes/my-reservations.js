const express = require("express");
const { requireCsrf } = require("../middleware/permissions");
const service = require("../services/reservation-service");

const router = express.Router();

const statuses = [
    "active", "all", "queued", "ready", "collected", "cancelled", "expired"
];

const isId = value =>
    typeof value === "string"
    && /^[1-9]\d{0,9}$/.test(value)
    && Number(value) <= 4294967295;

const isPage = value =>
    typeof value === "string" && /^[1-9]\d{0,8}$/.test(value);

const asyncRoute = handler => (req, res, next) =>
    Promise.resolve(handler(req, res, next)).catch(next);

router.use((req, res, next) => {
    res.set("Cache-Control", "no-store");

    if (!Number.isInteger(req.session?.userId) || req.session.userId < 1) {
        return res.status(401).json({
            code: "SIGN_IN_REQUIRED",
            message: "Please sign in to manage your reservations."
        });
    }

    next();
});

function requireJson(req, res, next) {
    if (!req.is("application/json")) {
        return res.status(415).json({
            message: "Send information as JSON."
        });
    }

    next();
}

router.get("/options/:bookId", asyncRoute(async (req, res) => {
    if (!isId(req.params.bookId) || Object.keys(req.query).length > 0) {
        return res.status(400).json({
            message: "Choose a valid book without additional filters."
        });
    }

    res.json(await service.getOptions(Number(req.params.bookId)));
}));

router.get("/", asyncRoute(async (req, res) => {
    const status = req.query.status ?? "active";
    const page = req.query.page ?? "1";

    if (
        Object.keys(req.query).some(key => !["status", "page"].includes(key))
        || !statuses.includes(status)
        || !isPage(page)
    ) {
        return res.status(400).json({
            message: "The reservation filters are invalid."
        });
    }

    res.json(await service.getMyReservations(req.session.userId, {
        status,
        page: Number(page)
    }));
}));

router.post(
    "/",
    requireJson,
    requireCsrf,
    asyncRoute(async (req, res) => {
        const values = req.body;

        if (
            !values
            || typeof values !== "object"
            || Array.isArray(values)
            || Object.keys(values).some(
                key => !["bookId", "branchId"].includes(key)
            )
            || !isId(values.bookId)
            || !isId(values.branchId)
        ) {
            return res.status(400).json({
                message: "Choose a valid book and collection branch."
            });
        }

        const result = await service.reserveBook(req.session.userId, {
            bookId: Number(values.bookId),
            branchId: Number(values.branchId)
        });

        // Repeated requests may return an existing reservation.
        res.json(result);
    })
);

router.post(
    "/:reservationId/cancel",
    requireJson,
    requireCsrf,
    asyncRoute(async (req, res) => {
        if (!isId(req.params.reservationId)) {
            return res.status(400).json({
                message: "Choose a valid reservation."
            });
        }

        if (
            !req.body
            || typeof req.body !== "object"
            || Array.isArray(req.body)
            || Object.keys(req.body).length > 0
        ) {
            return res.status(400).json({
                message: "Submit an empty JSON object to cancel a reservation."
            });
        }

        res.json(await service.cancelMyReservation(
            req.session.userId,
            Number(req.params.reservationId)
        ));
    })
);

router.use((error, req, res, next) => {
    if (res.headersSent) return next(error);

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
            code: "RESERVATION_BUSY",
            message: "Another action is using this record. Refresh and try again."
        });
    }

    if (error.code === "ER_DUP_ENTRY") {
        return res.status(409).json({
            code: "RESERVATION_CONFLICT",
            message: "A reservation conflicts with this request. Refresh your reservations."
        });
    }

    next(error);
});

module.exports = router;