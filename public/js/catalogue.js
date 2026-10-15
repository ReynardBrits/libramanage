const searchForm = document.getElementById("catalogue-search");
const resultsContainer = document.getElementById("book-results");
const resultMessage = document.getElementById("result-message");

let activeController = null;

// Create elements without treating database values as HTML.
function createTextElement(tag, text, className = "") {
    const element = document.createElement(tag);

    element.textContent = text;

    if (className) {
        element.className = className;
    }

    return element;
}

// Display the books returned by the server.
function displayBooks(books) {
    resultsContainer.replaceChildren();

    if (books.length === 0) {
        resultMessage.textContent =
            "No books match your search. Try different keywords or filters.";

        return;
    }

    const ending = books.length === 1 ? "" : "s";

    resultMessage.textContent =
        `${books.length} result${ending} found.`;

    const fragment = document.createDocumentFragment();

    for (const book of books) {
        const card = document.createElement("article");
        card.className = "book-card";

        const availability = book.availableCopies > 0
            ? `${book.availableCopies} available`
            : "No copies available";

        const detailsLink = createTextElement(
            "a",
            "View details"
        );

        detailsLink.href =
            `/book-details.html?id=${encodeURIComponent(book.bookId)}`;

        detailsLink.setAttribute(
            "aria-label",
            `View details for ${book.title}`
        );

        card.append(
            createTextElement("h3", book.title),
            createTextElement("p", `By ${book.author}`),
            createTextElement("p", `ISBN: ${book.isbn}`),
            createTextElement("p", book.category),
            createTextElement("p", book.branchName),
            createTextElement(
                "p",
                availability,
                "book-availability"
            ),
            detailsLink
        );

        fragment.append(card);
    }

    resultsContainer.append(fragment);
}

// Request books using the current search form values.
async function loadBooks() {
    if (activeController) {
        activeController.abort();
    }

    const controller = new AbortController();
    activeController = controller;

    resultsContainer.replaceChildren();
    resultsContainer.setAttribute("aria-busy", "true");
    resultMessage.textContent = "Loading books...";

    const parameters = new URLSearchParams();
    const formData = new FormData(searchForm);

    for (const [name, value] of formData.entries()) {
        const cleanedValue = String(value).trim();

        if (cleanedValue) {
            parameters.set(name, cleanedValue);
        }
    }

    try {
        const response = await fetch(
            `/api/books?${parameters.toString()}`,
            {
                headers: {
                    Accept: "application/json"
                },
                signal: controller.signal
            }
        );

        if (!response.ok) {
            throw new Error(
                `Catalogue request failed with status ${response.status}.`
            );
        }

        const data = await response.json();

        if (controller.signal.aborted) {
            return;
        }

        if (!Array.isArray(data.books)) {
            throw new Error("Unexpected catalogue response.");
        }

        displayBooks(data.books);
    } catch (error) {
        if (controller.signal.aborted) {
            return;
        }

        console.error("Could not load books:", error.message);

        resultMessage.textContent =
            "We could not load the books. Please try searching again.";
    } finally {
        if (activeController === controller) {
            resultsContainer.removeAttribute("aria-busy");
            activeController = null;
        }
    }
}

searchForm.addEventListener("submit", (event) => {
    event.preventDefault();
    loadBooks();
});

loadBooks();