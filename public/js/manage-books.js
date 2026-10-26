(() => {
    const { byId, element, message, createApi, requestJson } = window.LibraUI;
    const api = createApi({ csrfError: "Could not prepare the form." });
    const bookForm = byId("book-form");
    const saveButton = byId("save-book-button");
    const cancelButton = byId("cancel-edit-button");
    const heading = byId("manage-heading");
    const intro = byId("manage-intro");
    const formMessage = byId("manage-message");
    const signInPrompt = byId("sign-in-prompt");
    const createdPrompt = byId("created-book-prompt");
    const createdLink = byId("created-book-link");
    const categorySelect = byId("categoryId");
    const publisherSelect = byId("publisherId");
    const authorSelect = byId("authorIds");
    const branchSelect = byId("branchId");
    const branchField = byId("branch-field");
    const copiesField = byId("copies-field");
    const yearInput = byId("publicationYear");
    const listSection = byId("book-list-section");
    const filterForm = byId("book-filters");
    const searchInput = byId("manage-search-term");
    const statusSelect = byId("manage-status");
    const tableBody = byId("book-table-body");
    const listMessage = byId("book-list-message");
    const pageMessage = byId("page-message");
    const previousButton = byId("previous-page");
    const nextButton = byId("next-page");
    const coverInput = byId("book-cover-file");
    const coverPreview = byId("book-cover-preview");
    const coverMessage = byId("book-cover-message");
    const uploadCoverButton = byId("upload-cover-button");
    const reloadCoverButton = byId("reload-cover-button");

    let editingId = null;
    let staffUserId = null;
    let busy = false;
    let currentPage = 1;
    let pageCount = 1;

    yearInput.max = String(new Date().getFullYear() + 1);

    function setBusy(value) {
        busy = value;

        for (const control of bookForm.elements) {
            const stock = ["branchId", "initialCopies"].includes(control.name);
            control.disabled = value || (editingId !== null && stock);
        }

        for (const control of filterForm.elements) {
            control.disabled = value;
        }

        for (const button of tableBody.querySelectorAll("button")) {
            button.disabled = value;
        }

        previousButton.disabled = value || currentPage <= 1;
        nextButton.disabled = value || currentPage >= pageCount;
        bookForm.setAttribute("aria-busy", String(value));
    }

    function editMode(bookId) {
        editingId = bookId;
        heading.textContent = "Edit book";
        intro.textContent = "Update the selected book's details or cover.";
        branchField.hidden = true;
        copiesField.hidden = true;
        cancelButton.hidden = false;
        uploadCoverButton.hidden = false;
        reloadCoverButton.hidden = false;
        saveButton.textContent = "Save changes";
    }

    function resetForm() {
        editingId = null;
        bookForm.reset();
        coverInput.value = "";
        coverPreview.replaceChildren();

        coverMessage.textContent =
            "A cover is optional. It will upload after the book is saved.";

        heading.textContent = "Add a book";
        intro.textContent =
            "Add a title and its first copies to a library branch.";

        branchField.hidden = false;
        copiesField.hidden = false;
        cancelButton.hidden = true;
        uploadCoverButton.hidden = true;
        reloadCoverButton.hidden = true;
        saveButton.textContent = "Add book";
        setBusy(busy);
    }

    function fillSelect(select, items, placeholder = null) {
        select.replaceChildren();

        if (placeholder !== null) {
            select.append(new Option(placeholder, ""));
        }

        for (const item of items) {
            select.append(new Option(item.name, String(item.id)));
        }
    }

    function hideWorkspace(text, signIn = false) {
        resetForm();
        tableBody.replaceChildren();
        bookForm.hidden = true;
        listSection.hidden = true;
        createdPrompt.hidden = true;
        signInPrompt.hidden = !signIn;
        message(formMessage, text, "error");
    }

    function handleAccessFailure(response, data) {
        if (
            response.status !== 401
            && !(response.status === 403 && data.code === "FORBIDDEN")
        ) {
            return false;
        }

        hideWorkspace(
            data.message || "You do not have access to manage books.",
            response.status === 401
        );

        return true;
    }

    async function checkStaff() {
        const { response, data } = await api.get("/api/auth/me");
        const user = data.user;

        if (
            !response.ok
            || !user
            || !["admin", "librarian"].includes(user.roleName)
            || !Number.isInteger(user.userId)
            || (staffUserId !== null && user.userId !== staffUserId)
        ) {
            hideWorkspace(
                "Your account access changed. Sign in and refresh this page.",
                true
            );

            throw new Error(
                "Your account access changed. Sign in and refresh this page."
            );
        }

        staffUserId = user.userId;
    }

    async function writeRequest(path, method, values) {
        await checkStaff();

        const send = () => requestJson(path, {
            method,
            headers: {
                "Content-Type": "application/json",
                Accept: "application/json",
                "X-CSRF-Token": api.csrfToken
            },
            body: JSON.stringify(values)
        });

        let result = await send();

        if (
            result.response.status === 403
            && result.data.code === "CSRF_INVALID"
        ) {
            await api.loadCsrfToken();
            await checkStaff();
            result = await send();
        }

        return result;
    }

    function responseError(data) {
        if (Array.isArray(data.errors)) {
            return [
                ...new Set(data.errors.map(error => error.message))
            ].join(" ");
        }

        return data.message || "The request could not be completed.";
    }

    function selectedCover(required = false) {
        const file = coverInput.files[0];

        if (!file) {
            if (required) {
                throw new Error("Choose a cover image first.");
            }

            return null;
        }

        if (!file.size || file.size > 8 * 1024 * 1024) {
            throw new Error(
                "Choose a non-empty cover image no larger than 8 MB."
            );
        }

        if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
            throw new Error("Choose a JPEG, PNG or WebP cover image.");
        }

        return file;
    }

    function displayCover(coverPath) {
        coverPreview.replaceChildren(
            window.LibraCovers.create({
                title: bookForm.elements.namedItem("title").value,
                coverPath
            }, { large: true })
        );
    }

    async function loadCover(bookId) {
        const { response, data } = await api.get(
            `/api/manage/book-covers/${bookId}`
        );

        if (handleAccessFailure(response, data)) {
            return false;
        }

        if (!response.ok) {
            throw new Error(responseError(data));
        }

        await checkStaff();
        displayCover(data.coverPath);

        coverMessage.textContent =
            "Current saved cover. Choose a file to replace it.";

        return true;
    }

    async function uploadCover(bookId, file) {
        await api.loadCsrfToken();
        await checkStaff();

        const body = new FormData();
        body.append("cover", file);

        const { response, data } = await requestJson(
            `/api/manage/book-covers/${bookId}`,
            {
                method: "PUT",
                headers: {
                    "X-CSRF-Token": api.csrfToken
                },
                body
            }
        );

        if (handleAccessFailure(response, data)) {
            throw new Error(
                "Sign in with your staff account and check the saved book."
            );
        }

        if (!response.ok) {
            throw new Error(responseError(data));
        }

        await checkStaff();
        displayCover(data.coverPath);
        coverInput.value = "";
        coverMessage.textContent = "Cover saved.";
    }

    function actionButton(text, label, work) {
        const button = element("button", text, "button-secondary");
        button.type = "button";
        button.disabled = busy;
        button.setAttribute("aria-label", label);
        button.addEventListener("click", work);
        return button;
    }

    function renderBooks(books) {
        tableBody.replaceChildren();

        for (const book of books) {
            const row = document.createElement("tr");
            const bookCell = document.createElement("th");
            bookCell.scope = "row";

            bookCell.append(
                element("strong", book.title),
                element("p", `ISBN: ${book.isbn}`, "book-isbn")
            );

            const actionCell = document.createElement("td");
            const actions = document.createElement("div");
            actions.className = "manage-actions";

            const statusText = book.status === "active" ? "Archive" : "Restore";

            actions.append(
                actionButton(
                    "Edit",
                    `Edit ${book.title}`,
                    () => startEditing(book.bookId)
                ),
                actionButton(
                    statusText,
                    `${statusText} ${book.title}`,
                    () => changeStatus(
                        book.bookId,
                        book.status === "active" ? "inactive" : "active"
                    )
                )
            );

            actionCell.append(actions);

            row.append(
                bookCell,
                element("td", book.author),
                element("td", book.category),
                element(
                    "td",
                    `${book.availableCopies} available of ${book.totalCopies}`
                ),
                element("td", book.status === "active" ? "Active" : "Archived"),
                actionCell
            );

            tableBody.append(row);
        }
    }

    async function loadList(page = 1) {
        listMessage.textContent = "Loading books...";

        const parameters = new URLSearchParams({
            search: searchInput.value.trim(),
            status: statusSelect.value,
            page: String(page)
        });

        try {
            const { response, data } = await api.get(
                `/api/manage/books?${parameters}`
            );

            if (handleAccessFailure(response, data)) {
                return false;
            }

            if (
                !response.ok
                || !Array.isArray(data.books)
                || !data.pagination
            ) {
                throw new Error(data.message || "Could not load books.");
            }

            await checkStaff();
            currentPage = data.pagination.page;
            pageCount = data.pagination.pageCount;
            renderBooks(data.books);

            const total = data.pagination.total;

            listMessage.textContent = total === 0
                ? "No books match your search."
                : `${total} book${total === 1 ? "" : "s"} found.`;

            pageMessage.textContent =
                `Page ${currentPage} of ${pageCount}`;

            return true;
        } catch (error) {
            console.error("Could not load book list:", error.message);

            listMessage.textContent =
                "We could not load the book list. Search again to retry.";

            return false;
        }
    }

    async function initialise() {
        setBusy(true);

        try {
            await checkStaff();

            const { response, data } = await api.get(
                "/api/manage/books/options"
            );

            if (handleAccessFailure(response, data)) {
                return;
            }

            if (!response.ok) {
                throw new Error("Could not load book options.");
            }

            fillSelect(categorySelect, data.categories, "Choose a category");
            fillSelect(publisherSelect, data.publishers, "Not recorded");
            fillSelect(authorSelect, data.authors);
            fillSelect(branchSelect, data.branches, "Choose a branch");

            await api.loadCsrfToken();

            if (!await loadList(1)) {
                return;
            }

            bookForm.hidden = false;
            listSection.hidden = false;
            formMessage.hidden = true;
        } catch (error) {
            message(
                formMessage,
                error.message || "Refresh the page to try again.",
                "error"
            );
        } finally {
            setBusy(false);
        }
    }

    async function startEditing(bookId) {
        if (busy) return;

        setBusy(true);
        createdPrompt.hidden = true;
        message(formMessage, "Loading book details...", "loading");

        try {
            const { response, data } = await api.get(
                `/api/manage/books/${bookId}`
            );

            if (handleAccessFailure(response, data)) {
                return;
            }

            if (
                !response.ok
                || !data.book
                || !Array.isArray(data.book.authorIds)
            ) {
                throw new Error(data.message || "Could not open this book.");
            }

            await checkStaff();
            resetForm();

            const book = data.book;
            editMode(book.bookId);

            bookForm.elements.namedItem("title").value = book.title;
            bookForm.elements.namedItem("isbn").value = book.isbn;
            categorySelect.value = String(book.categoryId);
            publisherSelect.value = book.publisherId ?? "";
            yearInput.value = book.publicationYear ?? "";

            bookForm.elements.namedItem("description").value =
                book.description || "";

            const selectedAuthors = new Set(book.authorIds.map(String));

            for (const option of authorSelect.options) {
                option.selected = selectedAuthors.has(option.value);
            }

            coverMessage.textContent = "Loading current cover...";

            if (!await loadCover(book.bookId)) {
                return;
            }

            message(formMessage, "Editing the selected book.", "info");
            bookForm.scrollIntoView({ block: "start" });
        } catch (error) {
            message(formMessage, error.message, "error");

            coverMessage.textContent =
                "Use Reload saved cover to try loading the cover again.";
        } finally {
            setBusy(false);
        }
    }

    bookForm.addEventListener("submit", async event => {
        event.preventDefault();
        if (busy) return;

        let file;

        try {
            file = selectedCover();
        } catch (error) {
            message(formMessage, error.message, "error");
            return;
        }

        // The cover has no name: only book fields go into the JSON request.
        const formData = new FormData(bookForm);
        const values = Object.fromEntries(formData.entries());
        values.authorIds = formData.getAll("authorIds");

        const isEditing = editingId !== null;
        const path = isEditing
            ? `/api/manage/books/${editingId}`
            : "/api/manage/books";

        let detailsSaved = false;

        setBusy(true);
        createdPrompt.hidden = true;
        saveButton.textContent = "Saving...";
        message(formMessage, "Saving book details...", "loading");

        try {
            const { response, data } = await writeRequest(
                path,
                isEditing ? "PUT" : "POST",
                values
            );

            if (handleAccessFailure(response, data)) {
                return;
            }

            if (!response.ok) {
                message(formMessage, responseError(data), "error");
                formMessage.focus();
                return;
            }

            detailsSaved = true;

            // Keep the saved ID so a failed cover upload cannot recreate the book.
            editMode(data.bookId);

            if (data.status === "active") {
                createdLink.href =
                    `/book-details.html?id=${encodeURIComponent(data.bookId)}`;

                createdPrompt.hidden = false;
            }

            if (file) {
                message(
                    formMessage,
                    "Book details saved. Uploading cover...",
                    "loading"
                );

                await uploadCover(data.bookId, file);
            }

            resetForm();

            message(
                formMessage,
                file ? `${data.message} Cover saved.` : data.message,
                "success"
            );

            await loadList(isEditing ? currentPage : 1);
        } catch (error) {
            const text = detailsSaved
                ? `Book details were saved, but the cover upload could not be confirmed. ${error.message} Reload the saved cover to check it, then use Upload selected cover to retry.`
                : "We could not confirm the save. Refresh the page and check the list before trying again.";

            message(formMessage, text, "error");

            if (detailsSaved && !bookForm.hidden) {
                await loadList(isEditing ? currentPage : 1);
            }
        } finally {
            saveButton.textContent = editingId === null
                ? "Add book"
                : "Save changes";

            setBusy(false);
        }
    });

    async function coverAction(upload) {
        if (busy || editingId === null) return;

        const bookId = editingId;
        let file;

        try {
            if (upload) {
                file = selectedCover(true);
            }
        } catch (error) {
            message(formMessage, error.message, "error");
            return;
        }

        setBusy(true);

        message(
            formMessage,
            upload ? "Uploading cover..." : "Loading saved cover...",
            "loading"
        );

        try {
            if (upload) {
                await uploadCover(bookId, file);
            } else if (!await loadCover(bookId)) {
                return;
            }

            message(
                formMessage,
                upload
                    ? "Cover saved. Book details were not changed."
                    : "Saved cover reloaded.",
                "success"
            );
        } catch (error) {
            message(
                formMessage,
                `${error.message} Reload the saved cover before retrying an upload.`,
                "error"
            );
        } finally {
            setBusy(false);
        }
    }

    async function changeStatus(bookId, status) {
        if (busy) return;

        setBusy(true);
        createdPrompt.hidden = true;

        message(
            formMessage,
            status === "inactive" ? "Archiving book..." : "Restoring book...",
            "loading"
        );

        try {
            const { response, data } = await writeRequest(
                `/api/manage/books/${bookId}/status`,
                "PATCH",
                { status }
            );

            if (handleAccessFailure(response, data)) {
                return;
            }

            if (!response.ok) {
                message(formMessage, responseError(data), "error");
                return;
            }

            if (editingId === bookId) {
                resetForm();
            }

            message(formMessage, data.message, "success");
            await loadList(currentPage);
        } catch (error) {
            message(
                formMessage,
                "We could not confirm the status change. Refresh the page and check the list.",
                "error"
            );
        } finally {
            setBusy(false);
        }
    }

    cancelButton.addEventListener("click", () => {
        if (busy) return;

        resetForm();
        formMessage.hidden = true;
        createdPrompt.hidden = true;
    });

    uploadCoverButton.addEventListener("click", () => coverAction(true));
    reloadCoverButton.addEventListener("click", () => coverAction(false));

    coverInput.addEventListener("change", () => {
        coverMessage.textContent = coverInput.files.length
            ? "New file selected. Save the book or use Upload selected cover when editing."
            : "No replacement selected. The saved cover will be kept.";
    });

    async function changePage(page) {
        if (busy) return;

        setBusy(true);

        try {
            await loadList(page);
        } finally {
            setBusy(false);
        }
    }

    filterForm.addEventListener("submit", event => {
        event.preventDefault();
        changePage(1);
    });

    previousButton.addEventListener(
        "click",
        () => changePage(currentPage - 1)
    );

    nextButton.addEventListener(
        "click",
        () => changePage(currentPage + 1)
    );

    window.addEventListener("pagehide", () => {
        hideWorkspace("Refresh to manage books.");
    });

    window.addEventListener("pageshow", event => {
        if (event.persisted) {
            window.location.reload();
        }
    });

    initialise();
})();