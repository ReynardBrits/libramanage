USE libramanage;

-- Store the relative path to each book's optimised cover.
-- Existing books keep NULL and will use a placeholder image.

ALTER TABLE books
    ADD COLUMN cover_path VARCHAR(255) NULL DEFAULT NULL;

-- Confirm that the column was added.

SHOW COLUMNS FROM books LIKE 'cover_path';