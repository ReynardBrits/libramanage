(() => {
    const { byId, message, requestJson } = window.LibraUI;

    const workspace = byId("cover-workspace");
    const notice = byId("cover-message");
    const signIn = byId("cover-sign-in");
    const searchForm = byId("cover-search-form");
    const searchInput = byId("cover-search");
    const select = byId("cover-book");
    const uploadForm = byId("cover-upload-form");
    const fileInput = byId("cover-file");
    const preview = byId("cover-preview");
    const previewMessage = byId("cover-preview-message");

    let userId = null;
    let selectedId = null;
    let busy = false;

    function clearPrivate() {
        workspace.hidden = true;
        uploadForm.hidden = true;
        select.replaceChildren();
        searchInput.value = "";
        fileInput.value = "";
        preview.hidden = true;
        preview.removeAttribute("src");
        previewMessage.textContent = "";
        selectedId = null;
    }

    function setBusy(value) {
        busy = value;
        workspace.setAttribute("aria-busy", String(value));

        for (const control of workspace.querySelectorAll("input, select, button")) {
            control.disabled = value;
        }
    }

    async function request(path, options) {
        const { response, data } = await requestJson(path, options);

        if (!response.ok) {
            if ([401, 403].includes(response.status)) {
                clearPrivate();
                signIn.hidden = response.status !== 401;
            }

            throw new Error(data.message || "The cover request failed.");
        }

        return data;
    }

    async function checkStaff() {
        const { user } = await request("/api/auth/me");

        if (
            !Number.isInteger(user?.userId)
            || !["admin", "librarian"].includes(user.roleName)
        ) {
            clearPrivate();
            throw new Error(
                "Sign in as an administrator or librarian to manage covers."
            );
        }

        if (userId !== null && userId !== user.userId) {
            clearPrivate();
            throw new Error(
                "The signed-in account changed. Refresh this page."
            );
        }

        userId = user.userId;
    }

    function showCover(coverPath) {
        preview.hidden = true;
        preview.removeAttribute("src");

        const validPath =
            /^\/covers\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.jpg$/;

        if (
            typeof coverPath !== "string"
            || !validPath.test(coverPath)
        ) {
            previewMessage.textContent =
                "No uploaded cover for this book.";
            return;
        }

        previewMessage.textContent = "Loading current cover...";
        preview.src = coverPath;
    }

    preview.addEventListener("load", () => {
        preview.hidden = false;
        previewMessage.textContent = "Current saved cover";
    });

    preview.addEventListener("error", () => {
        preview.hidden = true;
        previewMessage.textContent =
            "The saved cover could not be displayed. You can upload a replacement.";
    });

    async function searchBooks() {
        if (busy) return;

        setBusy(true);
        uploadForm.hidden = true;
        selectedId = null;
        select.replaceChildren();
        fileInput.value = "";
        showCover(null);

        try {
            await checkStaff();

            const query = new URLSearchParams({
                search: searchInput.value.trim(),
                status: "all",
                page: "1"
            });

            const data = await request(`/api/manage/books?${query}`);

            await checkStaff();

            if (!Array.isArray(data.books) || !data.pagination) {
                throw new Error("Unexpected book search response.");
            }

            select.append(new Option("Choose a book", ""));

            for (const book of data.books) {
                select.add(new Option(
                    `${book.title} — ${book.isbn}`,
                    book.bookId
                ));
            }

            workspace.hidden = false;
            signIn.hidden = true;

            message(
                notice,
                data.pagination.total > data.books.length
                    ? `Showing the first ${data.books.length} matches. Narrow your search to find another book.`
                    : `${data.books.length} matching books found.`
            );
        } catch (error) {
            message(notice, error.message, "error");
        } finally {
            setBusy(false);
        }
    }

    async function loadSelected() {
        if (busy) return;

        const bookId = select.value;
        selectedId = null;
        fileInput.value = "";
        uploadForm.hidden = true;
        showCover(null);

        if (!bookId) return;

        setBusy(true);

        try {
            await checkStaff();

            const data = await request(
                `/api/manage/book-covers/${bookId}`
            );

            await checkStaff();

            selectedId = bookId;

            preview.alt =
                `Saved cover for ${select.selectedOptions[0].textContent}`;

            showCover(data.coverPath);
            uploadForm.hidden = false;

            message(
                notice,
                "Choose an image to upload or replace this book's cover."
            );
        } catch (error) {
            message(notice, error.message, "error");
        } finally {
            setBusy(false);
        }
    }

    uploadForm.addEventListener("submit", async event => {
        event.preventDefault();

        if (busy || !selectedId) return;

        const file = fileInput.files[0];

        if (
            !file
            || file.size === 0
            || file.size > 8 * 1024 * 1024
        ) {
            message(
                notice,
                "Choose a non-empty image no larger than 8 MB.",
                "error"
            );
            return;
        }

        const bookId = selectedId;
        const body = new FormData();
        body.append("cover", file);

        setBusy(true);
        message(notice, "Uploading and compressing cover...", "loading");

        try {
            const token = await request("/api/auth/csrf-token");

            await checkStaff();

            const data = await request(
                `/api/manage/book-covers/${bookId}`,
                {
                    method: "PUT",
                    headers: {
                        "X-CSRF-Token": token.csrfToken
                    },
                    body
                }
            );

            await checkStaff();

            showCover(data.coverPath);
            fileInput.value = "";

            message(
                notice,
                data.message || "Book cover saved.",
                "success"
            );
        } catch (error) {
            message(
                notice,
                `${error.message} Reload the current cover before trying again.`,
                "error"
            );
        } finally {
            setBusy(false);
        }
    });

    searchForm.addEventListener("submit", event => {
        event.preventDefault();
        searchBooks();
    });

    select.addEventListener("change", loadSelected);
    byId("cover-reload").addEventListener("click", loadSelected);

    window.addEventListener("pagehide", clearPrivate);

    window.addEventListener("pageshow", event => {
        if (event.persisted) location.reload();
    });

    searchBooks();
})();