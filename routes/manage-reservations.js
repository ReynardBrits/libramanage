const express = require("express");
const { requireStaff, requireCsrf } = require("../middleware/permissions");
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
    next();
});

router.use(requireStaff);

function requireEmptyJson(req, res, next) {
    if (!req.is("application/json")) {
        return res.status(415).json({
            message: "Send information as JSON."
        });
    }

    if (
        !req.body
        || typeof req.body !== "object"
        || Array.isArray(req.body)
        || Object.keys(req.body).length > 0
    ) {
        return res.status(400).json({
            message: "Submit an empty JSON object for this action."
        });
    }

    next();
}

router.get("/", asyncRoute(async (req, res) => {
    const search = req.query.search ?? "";
    const status = req.query.status ?? "active";
    const page = req.query.page ?? "1";
    const branchId = req.query.branchId ?? "";

    if (
        Object.keys(req.query).some(
            key => !["search", "status", "page", "branchId"].includes(key)
        )
        || typeof search !== "string"
        || search.length > 150
        || !statuses.includes(status)
        || !isPage(page)
        || (branchId !== "" && !isId(branchId))
    ) {
        return res.status(400).json({
            message: "The reservation filters are invalid."
        });
    }

    res.json(await service.getStaffReservations({
        search: search.trim(),
        status,
        page: Number(page),
        branchId: branchId ? Number(branchId) : null
    }));
}));

router.post(
    "/expire-holds",
    requireEmptyJson,
    requireCsrf,
    asyncRoute(async (req, res) => {
        res.json(await service.expireHolds());
    })
);

const actions = {
    prepare: service.prepareReservation,
    collect: service.collectReservation,
    cancel: service.cancelStaffReservation
};

for (const [action, perform] of Object.entries(actions)) {
    router.post(
        `/:reservationId/${action}`,
        requireEmptyJson,
        requireCsrf,
        asyncRoute(async (req, res) => {
            if (!isId(req.params.reservationId)) {
                return res.status(400).json({
                    message: "Choose a valid reservation."
                });
            }

            res.json(await perform(
                Number(req.params.reservationId),
                req.staffUser.userId
            ));
        })
    );
}

router.use((error, req, res, next) => {
    if (res.headersSent) return next(error);

    if (error.status) {
        return res.status(error.status).json({
            code: error.code,
            message: error.message
        });
    }

    if (["ER_LOCK_DEADLOCK", "ER_LOCK_WAIT_TIMEOUT"].includes(error.code)) {
        return res.status(503).json({
            code: "RESERVATION_BUSY",
            message: "Another action is using this record. Refresh and try again."
        });
    }

    if (error.code === "ER_DUP_ENTRY") {
        return res.status(409).json({
            code: "RESERVATION_CONFLICT",
            message: "The reservation conflicts with another action. Refresh the list."
        });
    }

    next(error);
});

module.exports = router;