const path = require("path");

// Load environment settings before importing database modules.
require("dotenv").config({
    path: path.join(__dirname, ".env")
});

const express = require("express");
const pool = require("./config/database");
const catalogueRouter = require("./routes/catalogue");

const app = express();
const PORT = Number(process.env.PORT || 3000);

app.disable("x-powered-by");

// Check whether the application can communicate with MySQL.
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

// Catalogue API.
app.use("/api/books", catalogueRouter);

// Return JSON for API addresses that do not exist.
app.use("/api", (req, res) => {
    res.status(404).json({
        message: "API endpoint not found."
    });
});

// Serve the HTML, CSS and browser JavaScript.
app.use(express.static(path.join(__dirname, "public")));

// Verify the database connection before starting the website.
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