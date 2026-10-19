const path = require("path");

// Load settings before importing database modules.
require("dotenv").config({
    path: path.join(__dirname, ".env")
});

const express = require("express");
const helmet = require("helmet");

const pool = require("./config/database");
const catalogueRouter = require("./routes/catalogue");
const authRouter = require("./routes/auth");

const app = express();
const PORT = Number(process.env.PORT || 3000);

app.disable("x-powered-by");

// Add security headers.
app.use(
    helmet({
        contentSecurityPolicy: {
            directives: {
                "upgrade-insecure-requests":
                    process.env.NODE_ENV === "production" ? [] : null
            }
        }
    })
);

// Read JSON requests and limit their size.
app.use("/api", express.json({
    limit: "16kb"
}));

// Check the database connection.
app.get("/api/health", async (req, res) => {
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

// Application routes.
app.use("/api/books", catalogueRouter);
app.use("/api/auth", authRouter);

// Handle unknown API addresses.
app.use("/api", (req, res) => {
    res.status(404).json({
        message: "API endpoint not found."
    });
});

// Serve the website.
app.use(express.static(path.join(__dirname, "public")));

// Handle errors without exposing internal details.
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

    return res.status(500).json({
        message: "Something went wrong. Please try again."
    });
});

// Start only when MySQL is available.
async function startServer() {
    try {
        await pool.execute("SELECT 1");

        console.log("Connected to MySQL.");

        const server = app.listen(PORT, () => {
            console.log(
                `LibraManage is running at http://localhost:${PORT}`
            );
        });

        server.on("error", (error) => {
            console.error("Server error:", error.message);
            process.exit(1);
        });
    } catch (error) {
        console.error("Database connection failed:", error.message);

        await pool.end();
        process.exitCode = 1;
    }
}

startServer();