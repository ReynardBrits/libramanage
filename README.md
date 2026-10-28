# LibraManage

LibraManage is a full-stack library management application for the Pretoria and Centurion branches.

**Live application:** [https://libramanage.onrender.com](https://libramanage.onrender.com)

## Technologies

- HTML, CSS and JavaScript
- Node.js and Express
- MySQL
- Sharp for book-cover image processing
- Render for application hosting
- Aiven for hosted MySQL

## Features

### Public catalogue

- Search and browse books.
- View book details and cover images.
- View availability at each branch.
- Display one catalogue entry per book with branch availability underneath.
- Browse results using pagination, with 10 books per page.

### Member accounts

- Register, sign in and sign out.
- View account information and member number.
- View borrowing records and fines.
- Make and cancel reservations.
- Submit payment requests for staff review.

### Staff functions

- Create, edit and delete books, subject to validation and existing records.
- Upload, replace and remove book covers through Manage Books.
- Issue books to members and record returns.
- Review payment requests.
- Prepare reservations and record collection.
- Release expired reservation holds.

## Project structure

| Location | Purpose |
| --- | --- |
| `server.js` | Application startup, middleware and routing |
| `config/` | Database and session configuration |
| `middleware/` | Authentication, permissions, validation and CSRF protection |
| `routes/` | API endpoints |
| `services/` | Business rules and database operations |
| `utils/` | Shared utility functions |
| `public/` | HTML pages, stylesheets and browser JavaScript |
| `database/` | Database schema and sample-data scripts |
| `scripts/` | Administrative command-line tools |

## Local installation

These instructions are for a fresh installation using a separate local development database.

### 1. Install the requirements

Install:

- Node.js 24.x
- MySQL 8.4 or a compatible MySQL version
- MySQL Workbench
- Git

### 2. Download the project

Open PowerShell and run:

```powershell
git clone https://github.com/ReynardBrits/libramanage.git
cd libramanage
npm.cmd ci
```

`npm.cmd` also works when PowerShell blocks the `npm.ps1` script.

### 3. Create the database

Connect to local MySQL in Workbench using an account that can create databases, tables and routines.

For a new database, open and execute these files in order:

1. `database/01-catalogue-schema.sql`
2. `database/03-user-accounts.sql`
3. `database/04-sessions.sql`
4. `database/05-loans-and-fines.sql`
5. `database/07-payment-requests.sql`
6. `database/08-reservations.sql`
7. `database/09-book-covers.sql`

Create the two branches before importing the sample books:

```sql
USE libramanage;

INSERT INTO branches (branch_code, branch_name, status)
VALUES
    ('pretoria', 'Pretoria Branch', 'active'),
    ('centurion', 'Centurion Branch', 'active');
```

Then execute:

```text
database/10-real-books.sql
```

This imports 50 real book titles and creates two sample copies per title at each branch.

The database contains 17 related tables covering books, branches, users, sessions, loans, fines, payments and reservations.

`database/06-overdue-demo.sql` is an optional demonstration script. It changes an existing open loan to demonstrate overdue behaviour and is not part of normal installation.

### 4. Create a local application database account

In Workbench, replace the password placeholder below with a unique password before executing:

```sql
CREATE USER 'libramanage_app'@'localhost'
    IDENTIFIED BY 'replace_with_a_unique_password';

GRANT SELECT, INSERT, UPDATE, DELETE
    ON libramanage.*
    TO 'libramanage_app'@'localhost';
```

The application uses this restricted account. Run database setup scripts with the separate setup account.

### 5. Configure environment variables

From the project folder, run:

```powershell
Copy-Item .env.example .env
```

Generate a session secret:

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Edit `.env`:

```dotenv
NODE_ENV=development
PORT=3000

DB_HOST=localhost
DB_PORT=3306
DB_USER=libramanage_app
DB_PASSWORD=your_unique_database_password
DB_NAME=libramanage
DB_SSL_CA=

SESSION_SECRET=your_generated_64_character_hex_secret

BOOK_COVER_DIR=./storage/covers
```

Replace both password and session-secret placeholders with your private values.

Leave `DB_SSL_CA` empty for local MySQL. Remote database connections require the path to the provider's CA certificate.

`.env` is excluded from Git.

### 6. Start the application

```powershell
npm.cmd start
```

Open [http://localhost:3000](http://localhost:3000).

Access the application through the Node.js server so the pages can communicate with the API.

To stop the server, press `Ctrl+C`.

### 7. Create an administrator

Register an account through the application first.

From the project folder, run the following command using that account's email address:

```powershell
node scripts/promote-admin.js "your-email@example.com"
```

Sign out and sign in again to access staff functions.

This command updates the database configured in `.env`.

## Render deployment

Prepare the hosted MySQL database using the schema and initial-data instructions above.

Provision a dedicated cloud database account with `SELECT`, `INSERT`, `UPDATE` and `DELETE` permissions on `libramanage.*`, and require encrypted connections.

### Service configuration

| Setting | Value |
| --- | --- |
| Service type | Node.js web service |
| Repository | `ReynardBrits/libramanage` |
| Branch | `main` |
| Region | Frankfurt |
| Root directory | Leave blank |
| Build command | `npm ci` |
| Start command | `npm start` |
| Health check path | `/api/health` |

The Node.js version is specified in `package.json`.

### Persistent storage

Attach a persistent disk mounted at:

```text
/var/data
```

Set the cover directory to:

```text
/var/data/covers
```

Uploaded images are stored outside the Git repository.

### Database certificate

Download the CA certificate from the database provider.

Add it to Render as a secret file named:

```text
ca.pem
```

Render makes this file available at:

```text
/etc/secrets/ca.pem
```

### Environment variables

| Variable | Value |
| --- | --- |
| `NODE_ENV` | `production` |
| `DB_HOST` | Hosted MySQL hostname |
| `DB_PORT` | Hosted MySQL port |
| `DB_USER` | Restricted application database username |
| `DB_PASSWORD` | Private application database password |
| `DB_NAME` | `libramanage` |
| `DB_SSL_CA` | `/etc/secrets/ca.pem` |
| `SESSION_SECRET` | A separately generated 64-character hex secret |
| `BOOK_COVER_DIR` | `/var/data/covers` |

Render supplies the service port.

Deploy the service and confirm the health endpoint returns:

```json
{
    "status": "ok",
    "database": "connected"
}
```

Uploaded covers from a local installation must be transferred separately or uploaded again through the hosted application.

## Book covers

Staff can manage covers while creating or editing a book.

Uploaded images:

- Accept JPEG, PNG and WebP.
- Have an upload limit of 8 MB.
- Are validated and processed by Sharp.
- Are resized to fit within 600 × 900 pixels.
- Are saved as JPEG files with generated filenames.

Where available, the catalogue can also display covers from Open Library and Penguin Random House. A placeholder appears when no usable cover is available.

## Security measures

- Password hashing with scrypt and individual salts.
- Parameterised SQL queries.
- Backend input validation.
- Role-based access checks on staff API endpoints.
- CSRF protection for requests that change data.
- MySQL-backed sessions.
- HttpOnly and SameSite session cookies.
- Secure session cookies in production.
- Helmet security headers.
- API and authentication rate limiting.
- Certificate and hostname verification for remote MySQL connections.
- Environment-based configuration for secrets.

A CodeQL cookie alert is documented as an accepted local-development exception because local development uses HTTP. Production session cookies were separately verified to include Secure, HttpOnly and SameSite=Lax.

## Verification

Hosted checks completed on 28 October 2026 included:

- Database health and public catalogue access.
- Catalogue pagination without duplicate book IDs.
- Member login, reservation creation and cancellation.
- Denial of member access to a staff API endpoint.
- Staff book issue and return workflows.
- Cover uploads and persistence after a service restart.
- Production session-cookie flags.
- Rejection of a state-changing request without a CSRF token.

These checks combine public HTTP checks and manual application checks. They do not establish load capacity or exhaustive test coverage.

There is currently no committed automated test suite or `npm test` command.

## Current limitations

- Rate-limit counters are stored in application memory.
- The persistent-disk deployment is configured for one application instance.
- Expired reservation holds are released through the staff workflow.
- Payments use a request-and-review workflow; no external payment gateway is integrated.
- Administrator promotion is performed through the command-line script.
- Database and uploaded-cover backups must be managed separately.

## Author

Reynard Brits