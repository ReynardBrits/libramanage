const express = require("express");
const pool = require("../config/database");
const { pagination, transaction } = require("../utils/service-helpers");

const router = express.Router();
const PAGE_SIZE = 10;

const AUTHOR_NAMES = `
    GROUP_CONCAT(
        CONCAT_WS(' ', a.first_name, a.last_name)
        ORDER BY a.last_name, a.first_name
        SEPARATOR ', '
    )
`;

// Paginate books before loading their branch availability.
router.get("/", async (req, res) => {
    const filters = {};
    const limits = { search: 150, branch: 30, category: 100 };

    for (const [name, maximumLength] of Object.entries(limits)) {
        const value = req.query[name] ?? "";

        if (typeof value !== "string" || value.length > maximumLength) {
            return res.status(400).json({
                message: "Please use valid search and filter values."
            });
        }

        filters[name] = value.trim();
    }

    const requestedPage = req.query.page ?? "1";

    if (
        typeof requestedPage !== "string"
        || !/^[1-9]\d{0,8}$/.test(requestedPage)
    ) {
        return res.status(400).json({
            message: "Choose a valid page number."
        });
    }

    const conditions = ["b.status = 'active'"];
    const parameters = [];

    if (filters.search) {
        conditions.push(`(
            LOCATE(?, b.title) > 0
            OR LOCATE(?, b.isbn) > 0
            OR EXISTS (
                SELECT 1
                FROM book_authors AS search_link
                JOIN authors AS search_author
                    ON search_author.author_id = search_link.author_id
                WHERE search_link.book_id = b.book_id
                    AND LOCATE(?, CONCAT_WS(
                        ' ',
                        search_author.first_name,
                        search_author.last_name
                    )) > 0
            )
        )`);

        parameters.push(
            filters.search,
            filters.search,
            filters.search
        );
    }

    if (filters.branch) {
        conditions.push(`EXISTS (
            SELECT 1
            FROM book_copies AS filter_copy
            JOIN branches AS filter_branch
                ON filter_branch.branch_id = filter_copy.branch_id
            WHERE filter_copy.book_id = b.book_id
                AND filter_branch.status = 'active'
                AND filter_branch.branch_code = ?
        )`);

        parameters.push(filters.branch);
    }

    if (filters.category) {
        conditions.push("c.category_name = ?");
        parameters.push(filters.category);
    }

    const selection = `
        FROM books AS b
        JOIN categories AS c ON c.category_id = b.category_id
        WHERE ${conditions.join(" AND ")}
    `;

    try {
        const result = await transaction(async connection => {
            const [counts] = await connection.execute(
                `SELECT COUNT(*) AS total ${selection}`,
                parameters
            );

            const pageInfo = pagination(
                Number(counts[0].total),
                Number(requestedPage),
                PAGE_SIZE
            );

            const offset = (pageInfo.page - 1) * PAGE_SIZE;

            const [books] = await connection.execute(`
                SELECT
                    b.book_id AS bookId,
                    b.title,
                    b.isbn,
                    b.cover_path AS coverPath,
                    c.category_name AS category,
                    COALESCE((
                        SELECT ${AUTHOR_NAMES}
                        FROM book_authors AS ba
                        JOIN authors AS a
                            ON a.author_id = ba.author_id
                        WHERE ba.book_id = b.book_id
                    ), 'Unknown author') AS author
                ${selection}
                ORDER BY b.title, b.book_id
                LIMIT ${PAGE_SIZE} OFFSET ${offset}
            `, parameters);

            if (books.length === 0) {
                return {
                    books: [],
                    pagination: pageInfo
                };
            }

            const placeholders = books.map(() => "?").join(", ");
            const stockParameters = books.map(book => book.bookId);
            const branchCondition = filters.branch
                ? "AND br.branch_code = ?"
                : "";

            if (filters.branch) {
                stockParameters.push(filters.branch);
            }

            const [stock] = await connection.execute(`
                SELECT
                    bc.book_id AS bookId,
                    br.branch_code AS branch,
                    br.branch_name AS branchName,
                    SUM(
                        CASE WHEN bc.copy_status = 'available'
                            THEN 1 ELSE 0
                        END
                    ) AS availableCopies
                FROM book_copies AS bc
                JOIN branches AS br ON br.branch_id = bc.branch_id
                WHERE br.status = 'active'
                    AND bc.book_id IN (${placeholders})
                    ${branchCondition}
                GROUP BY
                    bc.book_id,
                    br.branch_id,
                    br.branch_code,
                    br.branch_name
                ORDER BY br.branch_name
            `, stockParameters);

            const branchesByBook = new Map();

            for (const row of stock) {
                const key = String(row.bookId);

                if (!branchesByBook.has(key)) {
                    branchesByBook.set(key, []);
                }

                branchesByBook.get(key).push({
                    branch: row.branch,
                    branchName: row.branchName,
                    availableCopies: Number(row.availableCopies)
                });
            }

            return {
                books: books.map(book => ({
                    ...book,
                    branches: branchesByBook.get(String(book.bookId)) || []
                })),
                pagination: pageInfo
            };
        }, true);

        res.set("Cache-Control", "no-store");
        return res.json(result);
    } catch (error) {
        console.error("Catalogue query failed:", error.message);

        return res.status(500).json({
            message: "We could not load the catalogue. Please try again."
        });
    }
});

// GET /api/books/:bookId
router.get("/:bookId", async (req, res) => {
    const rawBookId = req.params.bookId;

    if (
        !/^[1-9]\d{0,9}$/.test(rawBookId)
        || Number(rawBookId) > 4294967295
    ) {
        return res.status(400).json({
            message: "Please provide a valid book ID."
        });
    }

    const bookId = Number(rawBookId);

    const bookSql = `
        SELECT
            b.book_id AS bookId,
            b.title,
            b.isbn,
            b.cover_path AS coverPath,
            b.description,
            b.publication_year AS publicationYear,
            c.category_name AS category,
            p.publisher_name AS publisher,
            COALESCE(
                (
                    SELECT ${AUTHOR_NAMES}
                    FROM book_authors AS ba
                    INNER JOIN authors AS a ON a.author_id = ba.author_id
                    WHERE ba.book_id = b.book_id
                ),
                'Unknown author'
            ) AS author
        FROM books AS b
        INNER JOIN categories AS c ON c.category_id = b.category_id
        LEFT JOIN publishers AS p ON p.publisher_id = b.publisher_id
        WHERE b.book_id = ? AND b.status = 'active'
    `;

    const stockSql = `
        SELECT
            br.branch_id AS branchId,
            br.branch_name AS branchName,
            COUNT(*) AS totalCopies,
            SUM(
                CASE WHEN bc.copy_status = 'available' THEN 1 ELSE 0 END
            ) AS availableCopies
        FROM book_copies AS bc
        INNER JOIN branches AS br ON br.branch_id = bc.branch_id
        WHERE bc.book_id = ? AND br.status = 'active'
        GROUP BY br.branch_id, br.branch_name
        ORDER BY br.branch_name
    `;

    try {
        const [books] = await pool.execute(bookSql, [bookId]);

        if (books.length === 0) {
            return res.status(404).json({
                message: "This book could not be found."
            });
        }

        const [stock] = await pool.execute(stockSql, [bookId]);

        const branches = stock.map(branch => ({
            ...branch,
            totalCopies: Number(branch.totalCopies),
            availableCopies: Number(branch.availableCopies)
        }));

        res.set("Cache-Control", "no-store");

        return res.json({
            book: {
                ...books[0],
                branches
            }
        });
    } catch (error) {
        console.error("Book details query failed:", error.message);

        return res.status(500).json({
            message: "We could not load this book. Please try again."
        });
    }
});

module.exports = router;