const pool = require("../config/database");

function fail(status, code, message) {
    return Object.assign(new Error(message), { status, code });
}

function pagination(total, requestedPage, pageSize = 10) {
    const pageCount = Math.max(1, Math.ceil(total / pageSize));

    return {
        page: Math.min(requestedPage, pageCount),
        pageCount,
        pageSize,
        total
    };
}

// Run related database operations together.
async function transaction(work, readOnly = false) {
    const connection = await pool.getConnection();
    let started = false;

    try {
        if (readOnly) {
            await connection.query(
                "START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY"
            );
        } else {
            await connection.beginTransaction();
        }

        started = true;

        const result = await work(connection);
        await connection.commit();

        return result;
    } catch (error) {
        if (started) {
            try {
                await connection.rollback();
            } catch (rollbackError) {
                console.error("Database rollback failed:", rollbackError.message);
            }
        }

        throw error;
    } finally {
        connection.release();
    }
}

module.exports = { fail, pagination, transaction };