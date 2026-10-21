const { randomUUID } = require("node:crypto");
const pool = require("../config/database");
const { pagination, transaction } = require("../utils/service-helpers");

const PAGE_SIZE = 20;

function httpError(status, message) {
    return Object.assign(new Error(message), { status });
}

async function lockBook(connection, bookId) {
    const [books] = await connection.execute(`
    SELECT book_id AS bookId, status FROM books
    WHERE book_id = ? FOR UPDATE
  `, [bookId]);

    if (!books.length) throw httpError(404, "This book could not be found.");
    return books[0];
}

async function getOptions() {
    const [[categories], [publishers], [authors], [branches]] = await Promise.all([
        pool.execute(`
      SELECT category_id AS id, category_name AS name
      FROM categories ORDER BY category_name
    `),
        pool.execute(`
      SELECT publisher_id AS id, publisher_name AS name
      FROM publishers ORDER BY publisher_name
    `),
        pool.execute(`
      SELECT author_id AS id, CONCAT_WS(' ', first_name, last_name) AS name
      FROM authors ORDER BY last_name, first_name
    `),
        pool.execute(`
      SELECT branch_id AS id, branch_name AS name
      FROM branches WHERE status = 'active' ORDER BY branch_name
    `)
    ]);

    return { categories, publishers, authors, branches };
}

async function listBooks({ search, status, page }) {
    const conditions = [];
    const parameters = [];

    if (status !== "all") {
        conditions.push("b.status = ?");
        parameters.push(status);
    }

    if (search) {
        conditions.push(`(
      LOCATE(?, b.title) > 0 OR LOCATE(?, b.isbn) > 0
      OR EXISTS (
        SELECT 1 FROM book_authors AS ba
        INNER JOIN authors AS a ON a.author_id = ba.author_id
        WHERE ba.book_id = b.book_id
          AND LOCATE(?, CONCAT_WS(' ', a.first_name, a.last_name)) > 0
      )
    )`);
        parameters.push(search, search, search);
    }

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const [counts] = await pool.execute(`
    SELECT COUNT(*) AS total FROM books AS b ${where}
  `, parameters);

    const pageInfo = pagination(Number(counts[0].total), page, PAGE_SIZE);
    const offset = (pageInfo.page - 1) * PAGE_SIZE;

    const [rows] = await pool.execute(`
    SELECT b.book_id AS bookId, b.title, b.isbn, b.status,
      c.category_name AS category,
      COALESCE((
        SELECT GROUP_CONCAT(
          CONCAT_WS(' ', a.first_name, a.last_name)
          ORDER BY a.last_name, a.first_name SEPARATOR ', '
        )
        FROM book_authors AS ba
        INNER JOIN authors AS a ON a.author_id = ba.author_id
        WHERE ba.book_id = b.book_id
      ), 'Unknown author') AS author,
      (
        SELECT COUNT(*) FROM book_copies AS bc
        WHERE bc.book_id = b.book_id
      ) AS totalCopies,
      (
        SELECT COUNT(*) FROM book_copies AS bc
        INNER JOIN branches AS br ON br.branch_id = bc.branch_id
        WHERE bc.book_id = b.book_id
          AND bc.copy_status = 'available' AND br.status = 'active'
      ) AS availableCopies
    FROM books AS b
    INNER JOIN categories AS c ON c.category_id = b.category_id
    ${where}
    ORDER BY b.title, b.book_id
    LIMIT ${PAGE_SIZE} OFFSET ${offset}
  `, parameters);

    return {
        books: rows.map(book => ({
            ...book,
            totalCopies: Number(book.totalCopies),
            availableCopies: book.status === "active" ? Number(book.availableCopies) : 0
        })),
        pagination: pageInfo
    };
}

async function getBook(bookId) {
    const [books] = await pool.execute(`
    SELECT book_id AS bookId, title, isbn, publisher_id AS publisherId,
      category_id AS categoryId, publication_year AS publicationYear,
      description, status
    FROM books WHERE book_id = ?
  `, [bookId]);

    if (!books.length) throw httpError(404, "This book could not be found.");

    const [authors] = await pool.execute(`
    SELECT author_id AS authorId FROM book_authors
    WHERE book_id = ? ORDER BY author_id
  `, [bookId]);

    return {
        ...books[0],
        authorIds: authors.map(author => Number(author.authorId))
    };
}

async function validateReferences(connection, values) {
    const [categories] = await connection.execute(`
    SELECT category_id FROM categories WHERE category_id = ? FOR SHARE
  `, [values.categoryId]);

    if (categories.length !== 1) {
        throw httpError(400, "Choose a category from the list.");
    }

    if (values.publisherId) {
        const [publishers] = await connection.execute(`
      SELECT publisher_id FROM publishers WHERE publisher_id = ? FOR SHARE
    `, [values.publisherId]);

        if (publishers.length !== 1) {
            throw httpError(400, "Choose a publisher from the list.");
        }
    }

    const authorIds = [...new Set(values.authorIds.map(Number))];
    const placeholders = authorIds.map(() => "?").join(", ");

    const [authors] = await connection.execute(`
    SELECT author_id FROM authors WHERE author_id IN (${placeholders}) FOR SHARE
  `, authorIds);

    if (authors.length !== authorIds.length) {
        throw httpError(400, "Choose authors from the available list.");
    }

    return authorIds;
}

function bookValues(values) {
    return [
        values.publisherId || null, values.categoryId, values.isbn,
        values.title, values.publicationYear || null, values.description || null
    ];
}

async function insertAuthors(connection, bookId, authorIds) {
    const rows = authorIds.map(() => "(?, ?)").join(", ");

    await connection.execute(`
    INSERT INTO book_authors (book_id, author_id) VALUES ${rows}
  `, authorIds.flatMap(authorId => [bookId, authorId]));
}

async function createBook(values) {
    return transaction(async connection => {
        const [branches] = await connection.execute(`
      SELECT branch_id FROM branches
      WHERE branch_id = ? AND status = 'active' FOR SHARE
    `, [values.branchId]);

        if (branches.length !== 1) {
            throw httpError(400, "Choose an active library branch.");
        }

        const authorIds = await validateReferences(connection, values);

        const [result] = await connection.execute(`
      INSERT INTO books (
        publisher_id, category_id, isbn, title, publication_year, description
      ) VALUES (?, ?, ?, ?, ?, ?)
    `, bookValues(values));

        const bookId = result.insertId;
        await insertAuthors(connection, bookId, authorIds);

        const copyRows = [];
        const copyParameters = [];

        for (let index = 0; index < values.initialCopies; index++) {
            copyRows.push("(?, ?, ?, CURRENT_DATE())");
            copyParameters.push(bookId, values.branchId, `LM-${randomUUID()}`);
        }

        await connection.execute(`
      INSERT INTO book_copies (book_id, branch_id, barcode, acquired_date)
      VALUES ${copyRows.join(", ")}
    `, copyParameters);

        const ending = values.initialCopies === 1 ? "copy" : "copies";

        return {
            message: `Book added with ${values.initialCopies} ${ending}.`,
            bookId, status: "active"
        };
    });
}

async function updateBook(bookId, values) {
    return transaction(async connection => {
        const book = await lockBook(connection, bookId);
        const authorIds = await validateReferences(connection, values);

        await connection.execute(`
      UPDATE books SET publisher_id = ?, category_id = ?, isbn = ?,
        title = ?, publication_year = ?, description = ?
      WHERE book_id = ?
    `, [...bookValues(values), bookId]);

        await connection.execute(
            "DELETE FROM book_authors WHERE book_id = ?", [bookId]
        );
        await insertAuthors(connection, bookId, authorIds);

        return {
            message: "Book details updated.",
            bookId, status: book.status
        };
    });
}

async function setBookStatus(bookId, status) {
    return transaction(async connection => {
        const book = await lockBook(connection, bookId);

        if (status === "inactive" && book.status !== "inactive") {
            const [copies] = await connection.execute(`
        SELECT copy_status FROM book_copies WHERE book_id = ? FOR UPDATE
      `, [bookId]);

            const hasPendingCopies = copies.some(copy =>
                ["on_loan", "reserved"].includes(copy.copy_status)
            );

            if (hasPendingCopies) {
                throw httpError(
                    409,
                    "Return or release loaned and reserved copies before archiving this book."
                );
            }
        }

        await connection.execute(
            "UPDATE books SET status = ? WHERE book_id = ?", [status, bookId]
        );

        return {
            bookId, status,
            message: status === "active"
                ? "Book restored to the catalogue."
                : "Book archived."
        };
    });
}

module.exports = {
    getOptions, listBooks, getBook, createBook, updateBook, setBookStatus
};