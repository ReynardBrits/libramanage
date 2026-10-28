const fs = require("node:fs");
const path = require("node:path");
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

const databasePort = Number(process.env.DB_PORT || 3306);

if (!Number.isInteger(databasePort) || databasePort < 1 || databasePort > 65535) {
    throw new Error("DB_PORT must be a whole number between 1 and 65535.");
}

const localHosts = new Set(["localhost", "127.0.0.1", "::1"]);
const caFile = process.env.DB_SSL_CA?.trim();
const needsTls = process.env.NODE_ENV === "production"
    || !localHosts.has(process.env.DB_HOST.toLowerCase());

if (needsTls && !caFile) {
    throw new Error("DB_SSL_CA is required for remote or production database connections.");
}

// Verify the certificate and hostname whenever TLS is enabled.
const ssl = caFile
    ? {
        ca: fs.readFileSync(path.resolve(__dirname, "..", caFile)),
        rejectUnauthorized: true,
        verifyIdentity: true,
        minVersion: "TLSv1.2"
    }
    : undefined;

// Reuse connections instead of opening a new one for every request.
const pool = mysql.createPool({
    host: process.env.DB_HOST,
    port: databasePort,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    charset: "utf8mb4",
    ssl,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 50,
    connectTimeout: 10000
});

module.exports = pool;