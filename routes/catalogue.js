const express = require("express");
const pool = require("../config/database");

const router = express.Router();

const AUTHOR_NAMES = `
  GROUP_CONCAT(
    CONCAT_WS(' ', a.first_name, a.last_name)
    ORDER BY a.last_name, a.first_name
    SEPARATOR ', '
  )
`;

// GET /api/books
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

    const conditions = ["b.status = 'active'"];
    const parameters = [];

    if (filters.search) {
        conditions.push(`
      (
        LOCATE(?, b.title) > 0
        OR LOCATE(?, b.isbn) > 0
        OR EXISTS (
          SELECT 1
          FROM book_authors AS search_link
          INNER JOIN authors AS search_author
            ON search_author.author_id = search_link.author_id
          WHERE search_link.book_id = b.book_id
            AND LOCATE(
              ?,
              CONCAT_WS(
                ' ', search_author.first_name, search_author.last_name
              )
            ) > 0
        )
      )
    `);

        parameters.push(filters.search, filters.search, filters.search);
    }

    if (filters.branch) {
        conditions.push("stock.branch_code = ?");
        parameters.push(filters.branch);
    }

    if (filters.category) {
        conditions.push("c.category_name = ?");
        parameters.push(filters.category);
    }

    // Aggregate authors separately from copies to avoid inflated copy counts.
    const sql = `
    SELECT
      b.book_id AS bookId,
      b.title,
      b.isbn,
      c.category_name AS category,
      COALESCE(author_list.author, 'Unknown author') AS author,
      stock.branch_code AS branch,
      COALESCE(stock.branch_name, 'Not currently stocked') AS branchName,
      COALESCE(stock.available_copies, 0) AS availableCopies
    FROM books AS b
    INNER JOIN categories AS c ON c.category_id = b.category_id
    LEFT JOIN (
      SELECT ba.book_id, ${AUTHOR_NAMES} AS author
      FROM book_authors AS ba
      INNER JOIN authors AS a ON a.author_id = ba.author_id
      GROUP BY ba.book_id
    ) AS author_list ON author_list.book_id = b.book_id
    LEFT JOIN (
      SELECT
        bc.book_id,
        br.branch_code,
        br.branch_name,
        SUM(
          CASE WHEN bc.copy_status = 'available' THEN 1 ELSE 0 END
        ) AS available_copies
      FROM book_copies AS bc
      INNER JOIN branches AS br ON br.branch_id = bc.branch_id
      WHERE br.status = 'active'
      GROUP BY
        bc.book_id, br.branch_id, br.branch_code, br.branch_name
    ) AS stock ON stock.book_id = b.book_id
    WHERE ${conditions.join(" AND ")}
    ORDER BY b.title, stock.branch_name, b.book_id
  `;

    try {
        const [rows] = await pool.execute(sql, parameters);
        const books = rows.map(book => ({
            ...book,
            availableCopies: Number(book.availableCopies)
        }));

        res.set("Cache-Control", "no-store");
        return res.json({ books });
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
        return res.json({ book: { ...books[0], branches } });
    } catch (error) {
        console.error("Book details query failed:", error.message);
        return res.status(500).json({
            message: "We could not load this book. Please try again."
        });
    }
});

module.exports = router;