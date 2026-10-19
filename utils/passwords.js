const {
    randomBytes,
    scrypt,
    timingSafeEqual
} = require("node:crypto");

const { promisify } = require("node:util");

const scryptAsync = promisify(scrypt);

const options = {
    N: 32768,
    r: 8,
    p: 3,
    maxmem: 64 * 1024 * 1024
};

// Create the same password format used during registration.
async function hashPassword(password) {
    const salt = randomBytes(16).toString("hex");

    const key = await scryptAsync(
        password,
        salt,
        64,
        options
    );

    return [
        "scrypt",
        options.N,
        options.r,
        options.p,
        salt,
        key.toString("hex")
    ].join("$");
}

// Compare a submitted password with a stored hash.
async function verifyPassword(password, storedHash) {
    if (typeof storedHash !== "string") {
        return false;
    }

    const parts = storedHash.split("$");

    if (parts.length !== 6) {
        return false;
    }

    const [algorithm, N, r, p, salt, keyHex] = parts;

    if (
        algorithm !== "scrypt" ||
        N !== String(options.N) ||
        r !== String(options.r) ||
        p !== String(options.p) ||
        !/^[0-9a-f]{32}$/.test(salt) ||
        !/^[0-9a-f]{128}$/.test(keyHex)
    ) {
        return false;
    }

    const actualKey = await scryptAsync(
        password,
        salt,
        64,
        options
    );

    const expectedKey = Buffer.from(keyHex, "hex");

    return timingSafeEqual(actualKey, expectedKey);
}

module.exports = {
    hashPassword,
    verifyPassword
};