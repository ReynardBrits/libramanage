(() => {
    const { byId, element } = window.LibraUI;

    const bookPage = byId("book-page");
    const bookTitle = byId("book-title");
    const bookMessage = byId("book-message");
    const bookInformation = byId("book-information");
    const bookCoverContainer = byId("book-cover-container");
    const bookMetadata = byId("book-metadata");
    const bookDescription = byId("book-description");
    const availabilitySection = byId("availability-section");
    const availabilityMessage = byId("availability-message");
    const branchResults = byId("branch-results");
    const reserveLink = byId("reserve-book-link");

    function displayBook(book, bookId) {
        document.title = `${book.title} | LibraManage`;
        bookTitle.textContent = book.title;

        bookCoverContainer.replaceChildren(
            window.LibraCovers.create(book, { large: true })
        );

        const metadata = [
            ["Author", book.author],
            ["ISBN", book.isbn],
            ["Category", book.category],
            ["Publisher", book.publisher || "Not recorded"],
            ["Publication year", book.publicationYear ?? "Not recorded"]
        ];

        bookMetadata.replaceChildren();

        for (const [label, value] of metadata) {
            bookMetadata.append(
                element("dt", label),
                element("dd", String(value ?? "Not recorded"))
            );
        }

        bookDescription.textContent =
            typeof book.description === "string" && book.description.trim()
                ? book.description.trim()
                : "No description is available for this book.";

        branchResults.replaceChildren();

        availabilityMessage.textContent = book.branches.length
            ? "Check the available copies at each branch."
            : "This book is not currently stocked at a branch.";

        for (const branch of book.branches) {
            const card = document.createElement("article");
            card.className = "book-card";

            card.append(
                element("h3", branch.branchName),
                element(
                    "p",
                    `Available copies: ${branch.availableCopies}`,
                    "book-availability"
                ),
                element("p", `Total copies: ${branch.totalCopies}`)
            );

            branchResults.append(card);
        }

        reserveLink.href =
            `/reservations.html?bookId=${encodeURIComponent(bookId)}`;
        reserveLink.hidden = false;

        bookMessage.textContent = "";
        bookInformation.hidden = false;
        availabilitySection.hidden = false;
    }

    async function loadBook() {
        const bookId = new URLSearchParams(window.location.search).get("id");

        if (
            !bookId ||
            !/^[1-9]\d{0,9}$/.test(bookId) ||
            Number(bookId) > 4294967295
        ) {
            bookMessage.textContent =
                "Choose a book from the catalogue to view its details.";
            return;
        }

        bookPage.setAttribute("aria-busy", "true");

        try {
            const response = await fetch(
                `/api/books/${encodeURIComponent(bookId)}`,
                {
                    headers: {
                        Accept: "application/json"
                    },
                    cache: "no-store"
                }
            );

            if (!response.ok) {
                bookMessage.textContent = response.status === 404
                    ? "This book could not be found."
                    : "Book details could not be loaded. Please try again.";
                return;
            }

            const data = await response.json();

            if (
                !data.book ||
                typeof data.book !== "object" ||
                !Array.isArray(data.book.branches)
            ) {
                throw new Error("The server returned invalid book details.");
            }

            displayBook(data.book, bookId);
        } catch (error) {
            console.error("Unable to load book details:", error);

            bookMessage.textContent =
                "Book details could not be loaded. Please refresh the page.";
        } finally {
            bookPage.removeAttribute("aria-busy");
        }
    }

    loadBook();
})();