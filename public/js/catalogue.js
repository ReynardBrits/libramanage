(() => {
    const { byId, element } = window.LibraUI;

    const searchForm = byId("catalogue-search");
    const resultsContainer = byId("book-results");
    const resultMessage = byId("result-message");

    let activeController = null;

    function displayBooks(books) {
        resultsContainer.replaceChildren();

        if (books.length === 0) {
            resultMessage.textContent =
                "No books match your search. Try different keywords or filters.";
            return;
        }

        const ending = books.length === 1 ? "" : "s";
        resultMessage.textContent = `${books.length} result${ending} found.`;

        const fragment = document.createDocumentFragment();

        for (const book of books) {
            const card = document.createElement("article");
            card.className = "book-card catalogue-card";

            const availability = book.availableCopies > 0
                ? `${book.availableCopies} available`
                : "No copies available";

            const detailsLink = element("a", "View details");

            detailsLink.href =
                `/book-details.html?id=${encodeURIComponent(book.bookId)}`;

            detailsLink.setAttribute(
                "aria-label",
                `View details for ${book.title}`
            );

            card.append(
                window.LibraCovers.create(book),
                element("h3", book.title),
                element("p", `By ${book.author}`),
                element("p", `ISBN: ${book.isbn}`),
                element("p", book.category),
                element("p", book.branchName),
                element("p", availability, "book-availability"),
                detailsLink
            );

            fragment.append(card);
        }

        resultsContainer.append(fragment);
    }

    async function loadBooks() {
        activeController?.abort();

        const controller = new AbortController();
        activeController = controller;

        resultsContainer.replaceChildren();
        resultsContainer.setAttribute("aria-busy", "true");
        resultMessage.textContent = "Loading books...";

        const parameters = new URLSearchParams();

        for (const [name, value] of new FormData(searchForm).entries()) {
            const cleanedValue = String(value).trim();

            if (cleanedValue) parameters.set(name, cleanedValue);
        }

        try {
            const response = await fetch(
                `/api/books?${parameters.toString()}`,
                {
                    headers: { Accept: "application/json" },
                    signal: controller.signal
                }
            );

            if (!response.ok) {
                throw new Error(
                    `Catalogue request failed with status ${response.status}.`
                );
            }

            const data = await response.json();

            if (controller.signal.aborted) return;

            if (!Array.isArray(data.books)) {
                throw new Error("Unexpected catalogue response.");
            }

            displayBooks(data.books);
        } catch (error) {
            if (controller.signal.aborted) return;

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

    searchForm.addEventListener("submit", event => {
        event.preventDefault();
        loadBooks();
    });

    loadBooks();
})();