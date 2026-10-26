(() => {
    const { byId, element } = window.LibraUI;

    const searchForm = byId("catalogue-search");
    const resultsContainer = byId("book-results");
    const resultsHeading = byId("results-heading");
    const resultMessage = byId("result-message");
    const pager = byId("catalogue-pagination");
    const pageMessage = byId("catalogue-page-message");
    const previousButton = byId("catalogue-previous");
    const nextButton = byId("catalogue-next");

    let activeController = null;
    let currentPage = 1;
    let pageCount = 1;
    let appliedFilters = readFilters();

    function readFilters() {
        const parameters = new URLSearchParams();

        for (const [name, value] of new FormData(searchForm).entries()) {
            const cleanedValue = String(value).trim();

            if (cleanedValue) {
                parameters.set(name, cleanedValue);
            }
        }

        return parameters;
    }

    function displayBooks(books) {
        const fragment = document.createDocumentFragment();

        for (const book of books) {
            const card = document.createElement("article");
            card.className = "book-card catalogue-card";

            card.append(
                window.LibraCovers.create(book),
                element("h3", book.title),
                element("p", `By ${book.author}`),
                element("p", `ISBN: ${book.isbn}`),
                element("p", book.category)
            );

            if (book.branches.length === 0) {
                card.append(element("p", "Not currently stocked"));
            }

            for (const branch of book.branches) {
                const availability = branch.availableCopies > 0
                    ? `${branch.availableCopies} available`
                    : "No copies available";

                card.append(
                    element(
                        "p",
                        `${branch.branchName}: ${availability}`,
                        "book-availability"
                    )
                );
            }

            const detailsLink = element("a", "View details");

            detailsLink.href =
                `/book-details.html?id=${encodeURIComponent(book.bookId)}`;

            detailsLink.setAttribute(
                "aria-label",
                `View details for ${book.title}`
            );

            card.append(detailsLink);
            fragment.append(card);
        }

        resultsContainer.replaceChildren(fragment);
    }

    function validateResponse(data) {
        const info = data.pagination;

        if (
            !Array.isArray(data.books)
            || data.books.length > 10
            || data.books.some(book => !book || !Array.isArray(book.branches))
            || !info
            || ![
                info.page,
                info.pageCount,
                info.pageSize,
                info.total
            ].every(Number.isInteger)
            || info.page < 1
            || info.pageCount < 1
            || info.page > info.pageCount
            || info.pageSize !== 10
            || info.total < 0
        ) {
            throw new Error("Unexpected catalogue response.");
        }
    }

    async function loadBooks(page = 1, moveFocus = false) {
        activeController?.abort();

        const controller = new AbortController();
        activeController = controller;

        const parameters = new URLSearchParams(appliedFilters);
        parameters.set("page", String(page));

        resultsContainer.replaceChildren();
        resultsContainer.setAttribute("aria-busy", "true");
        resultMessage.textContent = "Loading books...";
        pager.hidden = true;
        previousButton.disabled = true;
        nextButton.disabled = true;

        try {
            const response = await fetch(`/api/books?${parameters}`, {
                headers: {
                    Accept: "application/json"
                },
                cache: "no-store",
                signal: controller.signal
            });

            if (!response.ok) {
                throw new Error(
                    `Catalogue request failed with status ${response.status}.`
                );
            }

            const data = await response.json();

            if (controller.signal.aborted) {
                return;
            }

            validateResponse(data);

            const info = data.pagination;
            currentPage = info.page;
            pageCount = info.pageCount;

            displayBooks(data.books);

            if (info.total === 0) {
                resultMessage.textContent =
                    "No books match your search. Try different keywords or filters.";
            } else {
                const first = (currentPage - 1) * info.pageSize + 1;
                const last = first + data.books.length - 1;

                resultMessage.textContent =
                    `Showing ${first}–${last} of ${info.total} book${info.total === 1 ? "" : "s"}.`;
            }

            pageMessage.textContent =
                `Page ${currentPage} of ${pageCount}`;

            pager.hidden = pageCount <= 1;
            previousButton.disabled = currentPage <= 1;
            nextButton.disabled = currentPage >= pageCount;

            if (moveFocus) {
                resultsHeading.focus({ preventScroll: true });
                resultsHeading.scrollIntoView({ block: "start" });
            }
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

    searchForm.addEventListener("submit", event => {
        event.preventDefault();
        appliedFilters = readFilters();
        loadBooks(1);
    });

    previousButton.addEventListener("click", () => {
        if (!activeController && currentPage > 1) {
            loadBooks(currentPage - 1, true);
        }
    });

    nextButton.addEventListener("click", () => {
        if (!activeController && currentPage < pageCount) {
            loadBooks(currentPage + 1, true);
        }
    });

    loadBooks();
})();