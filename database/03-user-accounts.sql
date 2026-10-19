-- LibraManage: user accounts and membership
-- Run this script after creating the libramanage database.

USE libramanage;

-- Account types used by the application.
CREATE TABLE IF NOT EXISTS roles (
    role_id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    role_name VARCHAR(30) NOT NULL UNIQUE
) ENGINE=InnoDB;

-- Login details and personal information.
CREATE TABLE IF NOT EXISTS users (
    user_id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,

    role_id INT UNSIGNED NOT NULL,

    first_name VARCHAR(60) NOT NULL,
    last_name VARCHAR(60) NOT NULL,

    email VARCHAR(150) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,

    phone VARCHAR(25) NULL,

    status ENUM('active', 'inactive')
        NOT NULL DEFAULT 'active',

    created_at DATETIME
        NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_users_role
        FOREIGN KEY (role_id)
        REFERENCES roles(role_id)
) ENGINE=InnoDB;

-- Additional information for users who borrow books.
CREATE TABLE IF NOT EXISTS members (
    member_id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,

    user_id INT UNSIGNED NOT NULL UNIQUE,
    member_number VARCHAR(30) NOT NULL UNIQUE,

    date_joined DATE NOT NULL,

    borrowing_status ENUM('active', 'suspended')
        NOT NULL DEFAULT 'active',

    CONSTRAINT fk_members_user
        FOREIGN KEY (user_id)
        REFERENCES users(user_id)
) ENGINE=InnoDB;

-- Add the application roles.
-- Existing roles are preserved when this script is run again.
INSERT INTO roles (role_name)
VALUES
    ('member'),
    ('librarian'),
    ('admin')
ON DUPLICATE KEY UPDATE
    role_name = roles.role_name;

-- Check that the roles were created.
SELECT role_name
FROM roles
ORDER BY role_name;