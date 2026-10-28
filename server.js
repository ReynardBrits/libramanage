const path = require("path");

require("dotenv").config({
    path: path.join(__dirname, ".env")
});

const express = require("express");
const helmet = require("helmet");
const { rateLimit } = require("express-rate-limit");
const pool = require("./config/database");
const { requireCsrf } = require("./middleware/permissions");

const {
    sessionStore,
    sessionMiddleware
} = require("./config/session");

const catalogueRouter = require("./routes/catalogue");
const authRouter = require("./routes/auth");
const manageBooksRouter = require("./routes/manage-books");
const manageLoansRouter = require("./routes/manage-loans");
const myBorrowingRouter = require("./routes/my-borrowing");
const managePaymentsRouter = require("./routes/manage-payments");
const myReservationsRouter = require("./routes/my-reservations");
const manageReservationsRouter = require("./routes/manage-reservations");
const manageBookCoversRouter = require("./routes/manage-book-covers");

const {
    COVER_DIRECTORY,
    COVER_URL_PREFIX
} = require("./utils/book-covers");

const app = express();
const PORT = Number(process.env.PORT || 3000);

app.disable("x-powered-by");

// Trust Render's nearest proxy so secure session cookies work over HTTPS.
if (
    process.env.NODE_ENV === "production"
    && process.env.RENDER === "true"
) {
    app.set("trust proxy", 1);
}

app.use(
    helmet({
        contentSecurityPolicy: {
            directives: {
                "img-src": [
                    "'self'",
                    "data:",
                    "https://covers.openlibrary.org",
                    "https://images.penguinrandomhouse.com"
                ],
                "upgrade-insecure-requests":
                    process.env.NODE_ENV === "production"
                        ? []
                        : null
            }
        }
    })
);

// Limit API traffic before parsing bodies, reading sessions or querying MySQL.
app.use("/api", rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 300,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: {
        code: "RATE_LIMITED",
        message: "Too many requests. Please try again in 15 minutes."
    }
}));

app.use("/api", express.json({
    limit: "32kb"
}));

app.get("/api/health", async (req, res) => {
    res.set("Cache-Control", "no-store");

    try {
        await pool.execute("SELECT 1");

        res.json({
            status: "ok",
            database: "connected"
        });
    } catch (error) {
        console.error("Database check failed:", error.message);

        res.status(503).json({
            status: "error",
            database: "unavailable"
        });
    }
});

app.use("/api", sessionMiddleware);

// Require a session token before any API request that can change data.
app.use("/api", requireCsrf);

app.use("/api/books", catalogueRouter);
app.use("/api/auth", authRouter);
app.use("/api/manage/books", manageBooksRouter);
app.use("/api/manage/loans", manageLoansRouter);
app.use("/api/my-borrowing", myBorrowingRouter);
app.use("/api/manage/payments", managePaymentsRouter);
app.use("/api/my-reservations", myReservationsRouter);
app.use("/api/manage/reservations", manageReservationsRouter);
app.use("/api/manage/book-covers", manageBookCoversRouter);

app.use("/api", (req, res) => {
    res.status(404).json({
        message: "API endpoint not found."
    });
});

// Serve only the JPEG filenames created by our cover helper.
app.use(
    COVER_URL_PREFIX,
    (req, res, next) => {
        const validFilename =
            /^\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.jpg$/;

        if (
            !["GET", "HEAD"].includes(req.method)
            || !validFilename.test(req.path)
        ) {
            return res.status(404).end();
        }

        next();
    },
    express.static(COVER_DIRECTORY, {
        dotfiles: "deny",
        index: false,
        redirect: false,
        maxAge: "1d",
        immutable: true
    }),
    (req, res) => res.status(404).end()
);

app.use(express.static(path.join(__dirname, "public")));

app.use((error, req, res, next) => {
    if (res.headersSent) {
        return next(error);
    }

    if (error.type === "entity.parse.failed") {
        return res.status(400).json({
            message: "The request contains invalid JSON."
        });
    }

    if (error.type === "entity.too.large") {
        return res.status(413).json({
            message: "The submitted information is too large."
        });
    }

    console.error("Application error:", error.message);

    res.status(500).json({
        message: "Something went wrong. Please try again."
    });
});

async function startServer() {
    try {
        await sessionStore.onReady();
        await pool.execute("SELECT 1");
        await pool.execute("SELECT session_id FROM sessions LIMIT 1");

        console.log("Connected to MySQL.");
        console.log("Session storage is ready.");

        const server = app.listen(PORT, "0.0.0.0", () => {
            console.log(
                `LibraManage is listening on port ${PORT}.`
            );
        });

        server.on("error", error => {
            console.error("Server error:", error.message);
            process.exit(1);
        });
    } catch (error) {
        console.error("Server startup failed:", error.message);

        await Promise.allSettled([
            sessionStore.close(),
            pool.end()
        ]);

        process.exitCode = 1;
    }
}

startServer();