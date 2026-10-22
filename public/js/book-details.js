(() => {
    const { byId, element } = window.LibraUI;
    const bookPage = byId("book-page");
    const bookTitle = byId("book-title");
    const bookMessage = byId("book-message");
    const bookInformation = byId("book-information");
    const bookMetadata = byId("book-metadata");
    const bookDescription = byId("book-description");
    const availabilitySection = byId("availability-section");
    const availabilityMessage = byId("availability-message");
    const branchResults = byId("branch-results");

    function displayBook(book) {
        document.title = `${book.title} | LibraManage`;
        bookTitle.textContent = book.title;

        const details = [
            ["Author", book.author],
            ["ISBN", book.isbn],
            ["Category", book.category],
            ["Publisher", book.publisher || "Not recorded"],
            ["Publication year", book.publicationYear ?? "Not recorded"]
        ];

        bookMetadata.replaceChildren();

        for (const [label, value] of details) {
            bookMetadata.append(
                element("dt", label),
                element("dd", String(value))
            );
        }

        bookDescription.textContent = book.description?.trim()
            || "No description has been added for this book.";

        branchResults.replaceChildren();
        availabilityMessage.textContent = book.branches.length === 0
            ? "This book is not currently stocked at a branch."
            : "Check the available copies at each branch.";

        for (const branch of book.branches) {
            const card = document.createElement("article");
            card.className = "book-card";

            const availability = branch.availableCopies > 0
                ? `${branch.availableCopies} available`
                : "No copies available";

            card.append(
                element("h3", branch.branchName),
                element("p", availability, "book-availability"),
                element("p", `Total copies: ${branch.totalCopies}`)
            );

            branchResults.append(card);
        }

        bookMessage.textContent = "";
        bookInformation.hidden = false;
        availabilitySection.hidden = false;
    }

    async function loadBook() {
        const bookId = new URLSearchParams(window.location.search).get("id");

        if (
            !bookId
            || !/^[1-9]\d{0,9}$/.test(bookId)
            || Number(bookId) > 4294967295
        ) {
            bookMessage.textContent = "Please choose a book from the catalogue.";
            return;
        }

        bookPage.setAttribute("aria-busy", "true");

        try {
            const response = await fetch(
                `/api/books/${encodeURIComponent(bookId)}`,
                { headers: { Accept: "application/json" } }
            );

            if (!response.ok) {
                bookMessage.textContent = response.status === 404
                    ? "This book could not be found."
                    : "We could not load this book. Please try again.";
                return;
            }

            const data = await response.json();

            if (!data.book || !Array.isArray(data.book.branches)) {
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
})();