const mysql = require("mysql2/promise");

// Check that the required database settings were provided.
const requiredSettings = [
    "DB_HOST",
    "DB_USER",
    "DB_PASSWORD",
    "DB_NAME"
];

for (const setting of requiredSettings) {
    if (!process.env[setting]) {
        throw new Error(`Missing database setting: ${setting}`);
    }
}

// Reuse connections instead of opening a new one for every request.
const pool = mysql.createPool({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    charset: "utf8mb4",
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 50,
    connectTimeout: 10000
});

module.exports = pool;