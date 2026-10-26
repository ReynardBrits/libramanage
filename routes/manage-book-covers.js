const express = require("express");
const multer = require("multer");
const { rateLimit } = require("express-rate-limit");
const pool = require("../config/database");
const { transaction } = require("../utils/service-helpers");
const { requireStaff, requireCsrf } = require("../middleware/permissions");

const {
    MAX_COVER_BYTES,
    saveCover,
    deleteCover
} = require("../utils/book-covers");

const router = express.Router();

const asyncRoute = handler => (req, res, next) =>
    Promise.resolve(handler(req, res, next)).catch(next);

function httpError(status, message) {
    return Object.assign(new Error(message), { status });
}

router.use((req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
});

router.use(requireStaff);

router.param("bookId", (req, res, next, value) => {
    if (
        !/^[1-9]\d{0,9}$/.test(value)
        || Number(value) > 4294967295
    ) {
        return res.status(400).json({
            message: "Choose a valid book."
        });
    }

    req.bookId = Number(value);
    next();
});

const uploadLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 30,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: {
        message: "Too many cover uploads. Please try again later."
    }
});

const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: MAX_COVER_BYTES,
        files: 1,
        fields: 0,
        parts: 2,
        fieldNameSize: 50,
        headerPairs: 100
    },
    fileFilter(req, file, callback) {
        if (
            !["image/jpeg", "image/png", "image/webp"].includes(file.mimetype)
        ) {
            return callback(httpError(
                400,
                "Use a JPEG, PNG or WebP cover image."
            ));
        }

        callback(null, true);
    }
}).single("cover");

async function cleanupCover(coverPath) {
    try {
        await deleteCover(coverPath);
    } catch (error) {
        console.error("Cover cleanup failed:", error.message);
    }
}

router.get("/:bookId", asyncRoute(async (req, res) => {
    const [books] = await pool.execute(
        `SELECT book_id AS bookId, cover_path AS coverPath
         FROM books WHERE book_id = ?`,
        [req.bookId]
    );

    if (!books.length) {
        throw httpError(404, "The book could not be found.");
    }

    res.json(books[0]);
}));

router.put(
    "/:bookId",
    requireCsrf,
    uploadLimiter,
    (req, res, next) => {
        if (!req.is("multipart/form-data")) {
            return res.status(415).json({
                message: "Upload the cover using multipart form data."
            });
        }

        next();
    },
    upload,
    asyncRoute(async (req, res) => {
        if (!req.file?.buffer) {
            throw httpError(400, "Choose a cover image.");
        }

        // Sharp validates the actual image, not just its supplied MIME type.
        const coverPath = await saveCover(req.file.buffer);

        let oldCoverPath = null;
        let updateAttempted = false;

        try {
            await transaction(async connection => {
                const [books] = await connection.execute(
                    `SELECT cover_path AS coverPath
                     FROM books WHERE book_id = ? FOR UPDATE`,
                    [req.bookId]
                );

                if (!books.length) {
                    throw httpError(404, "The book could not be found.");
                }

                oldCoverPath = books[0].coverPath;
                updateAttempted = true;

                await connection.execute(
                    "UPDATE books SET cover_path = ? WHERE book_id = ?",
                    [coverPath, req.bookId]
                );
            });
        } catch (error) {
            if (!updateAttempted) {
                await cleanupCover(coverPath);
            } else {
                // A lost database response may leave the commit outcome unknown.
                // Keep the new file rather than delete a possibly referenced cover.
                console.error(
                    "Cover update failed; retained file:",
                    coverPath
                );
            }

            throw error;
        }

        // Clean up the previous managed cover after a confirmed commit.
        if (oldCoverPath && oldCoverPath !== coverPath) {
            try {
                const [references] = await pool.execute(
                    "SELECT COUNT(*) AS total FROM books WHERE cover_path = ?",
                    [oldCoverPath]
                );

                if (Number(references[0].total) === 0) {
                    await cleanupCover(oldCoverPath);
                }
            } catch (error) {
                console.error(
                    "Old cover reference check failed:",
                    error.message
                );
            }
        }

        res.json({
            bookId: req.bookId,
            coverPath,
            message: "Book cover saved."
        });
    })
);

router.use((error, req, res, next) => {
    if (res.headersSent) return next(error);

    if (error instanceof multer.MulterError) {
        const tooLarge = error.code === "LIMIT_FILE_SIZE";

        return res.status(tooLarge ? 413 : 400).json({
            message: tooLarge
                ? "Cover images must not exceed 8 MB."
                : "Upload one file named cover, without additional fields."
        });
    }

    if (error.status) {
        return res.status(error.status).json({
            message: error.message
        });
    }

    if (
        ["ER_LOCK_DEADLOCK", "ER_LOCK_WAIT_TIMEOUT"].includes(error.code)
    ) {
        return res.status(503).json({
            message: "Another action is using this book. Refresh before trying again."
        });
    }

    next(error);
});

module.exports = router;