-- LibraManage Step 9 Catalogue Schema
-- Initial catalogue tables for the LibraManage MySQL database.
-- Run this complete file in MySQL Workbench.

CREATE DATABASE IF NOT EXISTS libramanage
    CHARACTER SET utf8mb4
    COLLATE utf8mb4_0900_ai_ci;

USE libramanage;

-- Each physical book copy belongs to a library branch.
CREATE TABLE IF NOT EXISTS branches (
    branch_id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    branch_code VARCHAR(30) NOT NULL UNIQUE,
    branch_name VARCHAR(100) NOT NULL,
    status ENUM('active', 'inactive') NOT NULL DEFAULT 'active'
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS publishers (
    publisher_id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    publisher_name VARCHAR(150) NOT NULL UNIQUE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS categories (
    category_id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    category_name VARCHAR(100) NOT NULL UNIQUE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS authors (
    author_id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    first_name VARCHAR(80) NOT NULL,
    last_name VARCHAR(80) NOT NULL,
    INDEX idx_authors_name (last_name, first_name)
) ENGINE=InnoDB;

-- A book record describes a title, rather than a physical copy.
CREATE TABLE IF NOT EXISTS books (
    book_id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    publisher_id INT UNSIGNED,
    category_id INT UNSIGNED NOT NULL,
    isbn VARCHAR(20) NOT NULL UNIQUE,
    title VARCHAR(255) NOT NULL,
    publication_year SMALLINT UNSIGNED,
    description TEXT,
    status ENUM('active', 'inactive') NOT NULL DEFAULT 'active',

    CONSTRAINT fk_books_publisher
        FOREIGN KEY (publisher_id) REFERENCES publishers(publisher_id),

    CONSTRAINT fk_books_category
        FOREIGN KEY (category_id) REFERENCES categories(category_id),

    INDEX idx_books_title (title)
) ENGINE=InnoDB;

-- One book can have multiple authors, and an author can write multiple books.
CREATE TABLE IF NOT EXISTS book_authors (
    book_id INT UNSIGNED NOT NULL,
    author_id INT UNSIGNED NOT NULL,
    PRIMARY KEY (book_id, author_id),

    CONSTRAINT fk_book_authors_book
        FOREIGN KEY (book_id) REFERENCES books(book_id),

    CONSTRAINT fk_book_authors_author
        FOREIGN KEY (author_id) REFERENCES authors(author_id)
) ENGINE=InnoDB;

-- Every physical copy has its own barcode, branch and availability status.
CREATE TABLE IF NOT EXISTS book_copies (
    copy_id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    book_id INT UNSIGNED NOT NULL,
    branch_id INT UNSIGNED NOT NULL,
    barcode VARCHAR(50) NOT NULL UNIQUE,
    copy_status ENUM('available', 'on_loan', 'reserved', 'inactive')
        NOT NULL DEFAULT 'available',
    acquired_date DATE,

    CONSTRAINT fk_book_copies_book
        FOREIGN KEY (book_id) REFERENCES books(book_id),

    CONSTRAINT fk_book_copies_branch
        FOREIGN KEY (branch_id) REFERENCES branches(branch_id),

    INDEX idx_copies_book_branch_status (book_id, branch_id, copy_status),
    INDEX idx_copies_branch_status (branch_id, copy_status)
) ENGINE=InnoDB;

-- The result grid should list seven catalogue tables.
SHOW TABLES;

