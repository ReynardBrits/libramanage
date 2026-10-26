-- LibraManage: 50 real titles with sample inventory.
-- Years describe the listed editions.
-- Descriptions are short catalogue summaries.
-- Adds two sample copies per title to each branch.
-- Existing book details, covers and circulation records are preserved.

USE libramanage;

SET NAMES utf8mb4 COLLATE utf8mb4_0900_ai_ci;

DROP PROCEDURE IF EXISTS seed_libramanage_books;

DELIMITER $$

CREATE PROCEDURE seed_libramanage_books()
BEGIN
    DECLARE branch_count INT DEFAULT 0;

    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        ROLLBACK;
        RESIGNAL;
    END;

    DROP TEMPORARY TABLE IF EXISTS seed_books_50;
    DROP TEMPORARY TABLE IF EXISTS seed_authors_50;

    CREATE TEMPORARY TABLE seed_books_50 (
        isbn VARCHAR(20) PRIMARY KEY,
        title VARCHAR(255) NOT NULL,
        publisher VARCHAR(150) NOT NULL,
        category VARCHAR(100) NOT NULL,
        publication_year SMALLINT UNSIGNED NOT NULL,
        description TEXT NOT NULL,
        authors JSON NOT NULL
    ) ENGINE=InnoDB
        DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

    CREATE TEMPORARY TABLE seed_authors_50 (
        isbn VARCHAR(20) NOT NULL,
        first_name VARCHAR(80) NOT NULL,
        last_name VARCHAR(80) NOT NULL,
        PRIMARY KEY (isbn, first_name, last_name)
    ) ENGINE=InnoDB
        DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

    INSERT INTO seed_books_50 (
        isbn,
        title,
        publisher,
        category,
        publication_year,
        description,
        authors
    ) VALUES
        (
            '9781718502703',
            'Python Crash Course (3rd edition)',
            'No Starch Press',
            'Technology',
            2022,
            'Learn Python fundamentals through games, data visualisations and web projects.',
            '[["Eric","Matthes"]]'
        ),
        (
            '9781718503403',
            'Automate the Boring Stuff with Python (3rd edition)',
            'No Starch Press',
            'Technology',
            2025,
            'Use Python to automate repetitive computer tasks.',
            '[["Al","Sweigart"]]'
        ),
        (
            '9781593279509',
            'Eloquent JavaScript (3rd edition)',
            'No Starch Press',
            'Technology',
            2018,
            'Explore JavaScript programming, browser applications and practical projects.',
            '[["Marijn","Haverbeke"]]'
        ),
        (
            '9781633438538',
            'Grokking Algorithms (2nd edition)',
            'Manning',
            'Technology',
            2024,
            'An illustrated introduction to algorithms and data structures.',
            '[["Aditya Y.","Bhargava"]]'
        ),
        (
            '9780135957059',
            'The Pragmatic Programmer (20th anniversary edition)',
            'Addison-Wesley Professional',
            'Technology',
            2019,
            'Practical approaches to writing and maintaining software.',
            '[["David","Thomas"],["Andrew","Hunt"]]'
        ),
        (
            '9780262046305',
            'Introduction to Algorithms (4th edition)',
            'The MIT Press',
            'Technology',
            2022,
            'Study algorithm design, analysis and fundamental data structures.',
            '[["Thomas H.","Cormen"],["Charles E.","Leiserson"],["Ronald L.","Rivest"],["Clifford","Stein"]]'
        ),
        (
            '9780134757599',
            'Refactoring: Improving the Design of Existing Code (2nd edition)',
            'Addison-Wesley Professional',
            'Technology',
            2018,
            'Improve software structure through small, controlled code changes.',
            '[["Martin","Fowler"]]'
        ),
        (
            '9780201633610',
            'Design Patterns: Elements of Reusable Object-Oriented Software',
            'Addison-Wesley Professional',
            'Technology',
            1994,
            'A catalogue of reusable solutions to object-oriented design problems.',
            '[["Erich","Gamma"],["Richard","Helm"],["Ralph","Johnson"],["John","Vlissides"]]'
        ),
        (
            '9781593279523',
            'The Linux Command Line (2nd edition)',
            'No Starch Press',
            'Technology',
            2019,
            'Learn shell commands, file management and Bash scripting.',
            '[["William","Shotts"]]'
        ),
        (
            '9781718501065',
            'Practical SQL (2nd edition)',
            'No Starch Press',
            'Technology',
            2022,
            'Learn relational queries and data analysis using PostgreSQL examples.',
            '[["Anthony","DeBarros"]]'
        ),
        (
            '9780141036144',
            '1984',
            'Penguin',
            'Fiction',
            2008,
            'A man questions a society governed by surveillance and propaganda.',
            '[["George","Orwell"]]'
        ),
        (
            '9780241706985',
            'Animal Farm',
            'Penguin Classics',
            'Fiction',
            2024,
            'A farm rebellion becomes an allegory of power and corruption.',
            '[["George","Orwell"]]'
        ),
        (
            '9780241341469',
            'The Great Gatsby',
            'Penguin Classics',
            'Fiction',
            2018,
            'Wealth, ambition and longing collide in Jazz Age America.',
            '[["F. Scott","Fitzgerald"]]'
        ),
        (
            '9780141441146',
            'Jane Eyre',
            'Penguin Classics',
            'Fiction',
            2007,
            'A governess seeks independence, belonging and love.',
            '[["Charlotte","Brontë"]]'
        ),
        (
            '9780141199085',
            'Wuthering Heights',
            'Penguin Classics',
            'Fiction',
            2012,
            'Love and revenge shape two generations on the Yorkshire moors.',
            '[["Emily","Brontë"]]'
        ),
        (
            '9780143131847',
            'Frankenstein: The 1818 Text',
            'Penguin Classics',
            'Fiction',
            2018,
            'A scientist confronts the consequences of creating life.',
            '[["Mary","Shelley"]]'
        ),
        (
            '9780141199337',
            'Dracula',
            'Penguin Classics',
            'Fiction',
            2012,
            'A group of allies pursues a vampire threatening Victorian England.',
            '[["Bram","Stoker"]]'
        ),
        (
            '9780141192642',
            'The Picture of Dorian Gray',
            'Penguin Classics',
            'Fiction',
            2010,
            'A mysterious portrait records the consequences of a man''s choices.',
            '[["Oscar","Wilde"]]'
        ),
        (
            '9781529962260',
            'Great Expectations',
            'Vintage Classics',
            'Fiction',
            2025,
            'An unexpected fortune changes a young man''s ambitions and relationships.',
            '[["Charles","Dickens"]]'
        ),
        (
            '9780141439600',
            'A Tale of Two Cities',
            'Penguin Classics',
            'Fiction',
            2007,
            'Love and sacrifice unfold during the French Revolution.',
            '[["Charles","Dickens"]]'
        ),
        (
            '9780241736142',
            'Oliver Twist',
            'Puffin Classics',
            'Fiction',
            2026,
            'An orphan encounters poverty, crime and unexpected kindness in London.',
            '[["Charles","Dickens"]]'
        ),
        (
            '9780241804681',
            'Sense and Sensibility',
            'Penguin Classics',
            'Fiction',
            2026,
            'Two sisters navigate love, financial insecurity and social expectations.',
            '[["Jane","Austen"]]'
        ),
        (
            '9780143107712',
            'Emma',
            'Penguin Classics',
            'Fiction',
            2016,
            'A confident matchmaker discovers the limits of her judgement.',
            '[["Jane","Austen"]]'
        ),
        (
            '9780241804735',
            'Persuasion',
            'Penguin Classics',
            'Fiction',
            2026,
            'A woman encounters a former love and the possibility of another chance.',
            '[["Jane","Austen"]]'
        ),
        (
            '9780141385587',
            'Little Women',
            'Puffin Classics',
            'Fiction',
            2017,
            'The March sisters grow through family life, hardship and ambition.',
            '[["Louisa May","Alcott"]]'
        ),
        (
            '9780141321004',
            'Treasure Island',
            'Puffin Books',
            'Fiction',
            2008,
            'A young adventurer follows a treasure map into danger at sea.',
            '[["Robert Louis","Stevenson"]]'
        ),
        (
            '9781784872083',
            'The Time Machine',
            'Vintage Classics',
            'Fiction',
            2017,
            'A traveller discovers unsettling societies in the distant future.',
            '[["H. G.","Wells"]]'
        ),
        (
            '9780141441030',
            'The War of the Worlds',
            'Penguin Classics',
            'Fiction',
            2005,
            'An alien invasion overturns everyday life in England.',
            '[["H. G.","Wells"]]'
        ),
        (
            '9780141186887',
            'Things Fall Apart',
            'Penguin Classics',
            'Fiction',
            2010,
            'A community confronts internal tensions and colonial disruption.',
            '[["Chinua","Achebe"]]'
        ),
        (
            '9780099766810',
            'Cry, the Beloved Country',
            'Vintage Classics',
            'Fiction',
            2008,
            'A father searches for his son in a South Africa divided by injustice.',
            '[["Alan","Paton"]]'
        ),
        (
            '9780241733592',
            'The Odyssey',
            'Penguin Classics',
            'Fiction',
            2026,
            'Homer''s epic journey home, in Daniel Mendelsohn''s translation.',
            '[["Homer",""]]'
        ),
        (
            '9780143105954',
            'Moby-Dick',
            'Penguin Classics',
            'Fiction',
            2012,
            'A whaling captain pursues an obsession across the ocean.',
            '[["Herman","Melville"]]'
        ),
        (
            '9780141034355',
            'The Adventures of Sherlock Holmes',
            'Penguin Classics',
            'Fiction',
            2008,
            'Sherlock Holmes and Doctor Watson investigate twelve mysteries.',
            '[["Arthur Conan","Doyle"]]'
        ),
        (
            '9780099572954',
            'The Secret Garden',
            'Vintage Children''s Classics',
            'Fiction',
            2012,
            'A lonely child discovers a neglected garden and new friendships.',
            '[["Frances Hodgson","Burnett"]]'
        ),
        (
            '9780141441979',
            'Journey to the Centre of the Earth',
            'Penguin Classics',
            'Fiction',
            2009,
            'Explorers follow a mysterious clue into an underground world.',
            '[["Jules","Verne"]]'
        ),
        (
            '9781529913934',
            'Sapiens',
            'Vintage',
            'Non-fiction',
            2024,
            'An exploration of human history and the development of societies.',
            '[["Yuval Noah","Harari"]]'
        ),
        (
            '9781784703936',
            'Homo Deus',
            'Vintage',
            'Non-fiction',
            2017,
            'An examination of possible futures shaped by technology and human ambitions.',
            '[["Yuval Noah","Harari"]]'
        ),
        (
            '9781784708283',
            '21 Lessons for the 21st Century',
            'Vintage',
            'Non-fiction',
            2019,
            'Essays examining political, technological and social questions.',
            '[["Yuval Noah","Harari"]]'
        ),
        (
            '9780099511021',
            'Educated',
            'Windmill Books',
            'Non-fiction',
            2018,
            'A memoir about family, self-discovery and the pursuit of education.',
            '[["Tara","Westover"]]'
        ),
        (
            '9780241982976',
            'Becoming',
            'Penguin',
            'Non-fiction',
            2021,
            'Michelle Obama reflects on her childhood, career and public life.',
            '[["Michelle","Obama"]]'
        ),
        (
            '9780399588198',
            'Born a Crime',
            'One World',
            'Non-fiction',
            2019,
            'Trevor Noah recalls childhood and family life in South Africa.',
            '[["Trevor","Noah"]]'
        ),
        (
            '9780553109535',
            'A Brief History of Time',
            'Bantam',
            'Non-fiction',
            1998,
            'An introduction to cosmology, black holes and the nature of time.',
            '[["Stephen","Hawking"]]'
        ),
        (
            '9781846041242',
            'Man''s Search for Meaning',
            'Rider',
            'Non-fiction',
            2008,
            'A psychiatrist reflects on suffering, survival and the search for meaning.',
            '[["Viktor E.","Frankl"]]'
        ),
        (
            '9780141033570',
            'Thinking, Fast and Slow',
            'Penguin',
            'Non-fiction',
            2013,
            'Explore judgement, cognitive biases and different modes of thinking.',
            '[["Daniel","Kahneman"]]'
        ),
        (
            '9781847946249',
            'The Power of Habit',
            'Random House Books',
            'Non-fiction',
            2014,
            'An investigation of how habits form and change.',
            '[["Charles","Duhigg"]]'
        ),
        (
            '9781455586691',
            'Deep Work',
            'Grand Central Publishing',
            'Non-fiction',
            2016,
            'Strategies for focused work in an environment full of distractions.',
            '[["Cal","Newport"]]'
        ),
        (
            '9781784161859',
            'A Short History of Nearly Everything',
            'Black Swan',
            'Non-fiction',
            2016,
            'An accessible journey through scientific discoveries and natural history.',
            '[["Bill","Bryson"]]'
        ),
        (
            '9780316548182',
            'Long Walk to Freedom',
            'Little, Brown Paperbacks',
            'Non-fiction',
            1995,
            'Nelson Mandela recounts his life and the struggle against apartheid.',
            '[["Nelson","Mandela"]]'
        ),
        (
            '9781473637467',
            'Factfulness',
            'Sceptre',
            'Non-fiction',
            2018,
            'Use evidence to examine common misconceptions about the world.',
            '[["Hans","Rosling"],["Ola","Rosling"],["Anna","Rosling Rönnlund"]]'
        ),
        (
            '9780618253050',
            'Silent Spring',
            'Mariner Books Classics',
            'Non-fiction',
            2002,
            'An influential examination of pesticides and their environmental consequences.',
            '[["Rachel","Carson"]]'
        );

    -- Expand each book's author list into individual relationships.
    INSERT INTO seed_authors_50 (
        isbn,
        first_name,
        last_name
    )
    SELECT
        s.isbn,
        a.first_name,
        a.last_name
    FROM seed_books_50 AS s
    JOIN JSON_TABLE(
        s.authors,
        '$[*]' COLUMNS (
            first_name VARCHAR(80) PATH '$[0]',
            last_name VARCHAR(80) PATH '$[1]'
        )
    ) AS a ON TRUE;

    START TRANSACTION;

    SELECT COUNT(*) INTO branch_count
    FROM branches
    WHERE branch_code IN ('pretoria', 'centurion')
        AND status = 'active';

    IF branch_count <> 2 THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT =
                'Both Pretoria and Centurion must exist and be active.';
    END IF;

    -- Add missing categories.
    INSERT INTO categories (category_name)
    SELECT DISTINCT s.category
    FROM seed_books_50 AS s
    LEFT JOIN categories AS c
        ON c.category_name = s.category
    WHERE c.category_id IS NULL;

    -- Add missing publishers.
    INSERT INTO publishers (publisher_name)
    SELECT DISTINCT s.publisher
    FROM seed_books_50 AS s
    LEFT JOIN publishers AS p
        ON p.publisher_name = s.publisher
    WHERE p.publisher_id IS NULL;

    -- Reuse authors already recorded with the same name.
    INSERT INTO authors (
        first_name,
        last_name
    )
    SELECT DISTINCT
        s.first_name,
        s.last_name
    FROM seed_authors_50 AS s
    LEFT JOIN authors AS a
        ON a.first_name = s.first_name
        AND a.last_name = s.last_name
    WHERE a.author_id IS NULL;

    -- Matching ISBNs keep their existing details, status and covers.
    INSERT INTO books (
        publisher_id,
        category_id,
        isbn,
        title,
        publication_year,
        description,
        status
    )
    SELECT
        p.publisher_id,
        c.category_id,
        s.isbn,
        s.title,
        s.publication_year,
        s.description,
        'active'
    FROM seed_books_50 AS s
    JOIN publishers AS p
        ON p.publisher_name = s.publisher
    JOIN categories AS c
        ON c.category_name = s.category
    LEFT JOIN books AS b
        ON b.isbn = s.isbn
    WHERE b.book_id IS NULL;

    -- Connect books to their authors.
    INSERT INTO book_authors (
        book_id,
        author_id
    )
    SELECT DISTINCT
        b.book_id,
        a.author_id
    FROM seed_authors_50 AS s
    JOIN books AS b
        ON b.isbn = s.isbn
    JOIN (
        SELECT
            first_name,
            last_name,
            MIN(author_id) AS author_id
        FROM authors
        GROUP BY first_name, last_name
    ) AS a
        ON a.first_name = s.first_name
        AND a.last_name = s.last_name
    LEFT JOIN book_authors AS ba
        ON ba.book_id = b.book_id
        AND ba.author_id = a.author_id
    WHERE ba.book_id IS NULL;

    -- Fixed barcodes prevent duplicate sample copies when rerunning.
    INSERT INTO book_copies (
        book_id,
        branch_id,
        barcode,
        copy_status,
        acquired_date
    )
    SELECT
        b.book_id,
        br.branch_id,
        CONCAT(
            'DEMO50-',
            s.isbn,
            '-',
            br.branch_code,
            '-',
            n.copy_number
        ),
        'available',
        CURRENT_DATE()
    FROM seed_books_50 AS s
    JOIN books AS b
        ON b.isbn = s.isbn
    CROSS JOIN branches AS br
    CROSS JOIN (
        SELECT 1 AS copy_number
        UNION ALL
        SELECT 2
    ) AS n
    LEFT JOIN book_copies AS bc
        ON bc.barcode = CONCAT(
            'DEMO50-',
            s.isbn,
            '-',
            br.branch_code,
            '-',
            n.copy_number
        )
    WHERE br.branch_code IN ('pretoria', 'centurion')
        AND br.status = 'active'
        AND bc.copy_id IS NULL;

    COMMIT;

    -- Expected: 50 seeded titles and 200 sample copies.
    SELECT
        COUNT(DISTINCT b.book_id) AS seeded_titles,
        COUNT(DISTINCT bc.copy_id) AS sample_copies
    FROM seed_books_50 AS s
    JOIN books AS b
        ON b.isbn = s.isbn
    LEFT JOIN book_copies AS bc
        ON bc.book_id = b.book_id
        AND bc.barcode LIKE CONCAT(
            'DEMO50-',
            s.isbn,
            '-%'
        );

    SELECT
        category,
        COUNT(*) AS seeded_titles
    FROM seed_books_50
    GROUP BY category
    ORDER BY category;

    DROP TEMPORARY TABLE seed_authors_50;
    DROP TEMPORARY TABLE seed_books_50;
END$$

DELIMITER ;

CALL seed_libramanage_books();

DROP PROCEDURE seed_libramanage_books;