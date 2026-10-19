const path = require("node:path");

require("dotenv").config({
    path: path.join(__dirname, "..", ".env")
});

const pool = require("../config/database");

async function main() {
    const email = (process.argv[2] || "").trim().toLowerCase();

    let connection;
    let transactionStarted = false;

    try {
        if (
            process.argv.length !== 3 ||
            !email ||
            email.length > 150
        ) {
            throw new Error(
                "Usage: node scripts/promote-admin.js EMAIL_ADDRESS"
            );
        }

        connection = await pool.getConnection();

        await connection.beginTransaction();
        transactionStarted = true;

        // Lock the selected account while checking and updating it.
        const [users] = await connection.execute(
            `
                SELECT
                    user_id AS userId,
                    first_name AS firstName,
                    last_name AS lastName,
                    status
                FROM users
                WHERE email = ?
                FOR UPDATE
            `,
            [email]
        );

        if (users.length !== 1) {
            throw new Error(
                "No account was found with that email. Register the account first."
            );
        }

        const user = users[0];

        if (user.status !== "active") {
            throw new Error(
                "This account is inactive. Administrator access was not assigned."
            );
        }

        const [roles] = await connection.execute(
            `
                SELECT role_id AS roleId
                FROM roles
                WHERE role_name = ?
            `,
            ["admin"]
        );

        if (roles.length !== 1) {
            throw new Error(
                "The admin role is missing. Run 03-user-accounts.sql first."
            );
        }

        // Update only the account selected above.
        await connection.execute(
            `
                UPDATE users
                SET role_id = ?
                WHERE user_id = ?
            `,
            [roles[0].roleId, user.userId]
        );

        await connection.commit();
        transactionStarted = false;

        console.log("Administrator account is ready.");
        console.log(`Name: ${user.firstName} ${user.lastName}`);
        console.log(`Email: ${email}`);
        console.log("Role: admin");
    } catch (error) {
        if (connection && transactionStarted) {
            try {
                await connection.rollback();
            } catch (rollbackError) {
                console.error(
                    "Rollback failed:",
                    rollbackError.message
                );
            }
        }

        console.error("Administrator setup failed:", error.message);
        process.exitCode = 1;
    } finally {
        if (connection) {
            connection.release();
        }

        await pool.end();
    }
}

main().catch((error) => {
    console.error("Script error:", error.message);
    process.exitCode = 1;
});