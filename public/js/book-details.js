const bookPage = document.getElementById("book-page");
const bookTitle = document.getElementById("book-title");
const bookMessage = document.getElementById("book-message");
const bookInformation = document.getElementById("book-information");
const bookMetadata = document.getElementById("book-metadata");
const bookDescription = document.getElementById("book-description");

const availabilitySection =
    document.getElementById("availability-section");

const availabilityMessage =
    document.getElementById("availability-message");

const branchResults = document.getElementById("branch-results");

// Insert text safely into a new HTML element.
function createTextElement(tag, text, className = "") {
    const element = document.createElement(tag);

    element.textContent = text;

    if (className) {
        element.className = className;
    }

    return element;
}

// Display the book's information.
function displayBook(book) {
    document.title = `${book.title} | LibraManage`;
    bookTitle.textContent = book.title;

    const details = [
        ["Author", book.author],
        ["ISBN", book.isbn],
        ["Category", book.category],
        ["Publisher", book.publisher || "Not recorded"],
        [
            "Publication year",
            book.publicationYear ?? "Not recorded"
        ]
    ];

    bookMetadata.replaceChildren();

    for (const [label, value] of details) {
        bookMetadata.append(
            createTextElement("dt", label),
            createTextElement("dd", String(value))
        );
    }

    bookDescription.textContent =
        book.description?.trim() ||
        "No description has been added for this book.";

    branchResults.replaceChildren();

    if (book.branches.length === 0) {
        availabilityMessage.textContent =
            "This book is not currently stocked at a branch.";
    } else {
        availabilityMessage.textContent =
            "Check the available copies at each branch.";

        for (const branch of book.branches) {
            const card = document.createElement("article");
            card.className = "book-card";

            const availability = branch.availableCopies > 0
                ? `${branch.availableCopies} available`
                : "No copies available";

            card.append(
                createTextElement("h3", branch.branchName),
                createTextElement(
                    "p",
                    availability,
                    "book-availability"
                ),
                createTextElement(
                    "p",
                    `Total copies: ${branch.totalCopies}`
                )
            );

            branchResults.append(card);
        }
    }

    bookMessage.textContent = "";
    bookInformation.hidden = false;
    availabilitySection.hidden = false;
}

// Load the book identified by the page's URL.
async function loadBook() {
    const parameters = new URLSearchParams(window.location.search);
    const bookId = parameters.get("id");

    if (
        !bookId ||
        !/^[1-9]\d{0,9}$/.test(bookId) ||
        Number(bookId) > 4294967295
    ) {
        bookMessage.textContent =
            "Please choose a book from the catalogue.";

        return;
    }

    bookPage.setAttribute("aria-busy", "true");

    try {
        const response = await fetch(
            `/api/books/${encodeURIComponent(bookId)}`,
            {
                headers: {
                    Accept: "application/json"
                }
            }
        );

        if (!response.ok) {
            bookMessage.textContent = response.status === 404
                ? "This book could not be found."
                : "We could not load this book. Please try again.";

            return;
        }

        const data = await response.json();

        if (
            !data.book ||
            !Array.isArray(data.book.branches)
        ) {
            throw new Error("Unexpected book details response.");
        }

        displayBook(data.book);
    } catch (error) {
        console.error("Could not load book details:", error.message);

        bookMessage.textContent =
            "We could not load this book. Please refresh the page to try again.";
    } finally {
        bookPage.removeAttribute("aria-busy");
    }
}

loadBook();