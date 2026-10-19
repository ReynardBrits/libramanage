const session = require("express-session");
const MySQLStore = require("express-mysql-session")(session);

const pool = require("./database");

const secret = process.env.SESSION_SECRET;

if (
    typeof secret !== "string" ||
    !/^[0-9a-f]{64}$/i.test(secret)
) {
    throw new Error(
        "SESSION_SECRET must contain the 64-character value generated in the previous step."
    );
}

const sessionCookieName = "libramanage.sid";

const sessionCookieOptions = {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production"
};

const sessionDuration = 8 * 60 * 60 * 1000;

// Reuse the application's existing MySQL connection pool.
const sessionStore = new MySQLStore(
    {
        createDatabaseTable: false,
        clearExpired: true,
        checkExpirationInterval: 15 * 60 * 1000,
        expiration: sessionDuration,
        endConnectionOnClose: false
    },
    pool
);

sessionStore.on("error", (error) => {
    console.error("Session store error:", error.message);
});

const sessionMiddleware = session({
    name: sessionCookieName,
    secret,
    store: sessionStore,
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
        ...sessionCookieOptions,
        maxAge: sessionDuration
    }
});

module.exports = {
    sessionStore,
    sessionMiddleware,
    sessionCookieName,
    sessionCookieOptions
};