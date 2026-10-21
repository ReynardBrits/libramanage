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

let editingId = null;
let busy = false;
let currentPage = 1;
let pageCount = 1;

yearInput.max = String(new Date().getFullYear() + 1);

function setBusy(value) {
    busy = value;

    for (const control of bookForm.elements) {
        const stockControl = ["branchId", "initialCopies"].includes(control.name);
        control.disabled = value || (editingId !== null && stockControl);
    }

    for (const control of filterForm.elements) control.disabled = value;
    for (const button of tableBody.querySelectorAll("button")) button.disabled = value;

    previousButton.disabled = value || currentPage <= 1;
    nextButton.disabled = value || currentPage >= pageCount;
    bookForm.setAttribute("aria-busy", String(value));
}

function resetForm() {
    editingId = null;
    bookForm.reset();
    heading.textContent = "Add a book";
    intro.textContent = "Add a title and its first copies to a library branch.";
    branchField.hidden = false;
    copiesField.hidden = false;
    cancelButton.hidden = true;
    saveButton.textContent = "Add book";
    setBusy(busy);
}

function fillSelect(select, items, placeholder = null) {
    select.replaceChildren();
    if (placeholder !== null) select.append(new Option(placeholder, ""));
    for (const item of items) select.append(new Option(item.name, String(item.id)));
}

function handleAccessFailure(response, data) {
    if (response.status !== 401
        && !(response.status === 403 && data.code === "FORBIDDEN")) return false;

    bookForm.hidden = true;
    listSection.hidden = true;
    createdPrompt.hidden = true;
    signInPrompt.hidden = response.status !== 401;
    message(formMessage, data.message || "You do not have access to manage books.", "error");
    return true;
}

async function writeRequest(path, method, values) {
    const send = () => requestJson(path, {
        method,
        headers: {
            "Content-Type": "application/json", Accept: "application/json",
            "X-CSRF-Token": api.csrfToken
        },
        body: JSON.stringify(values)
    });

    let result = await send();
    if (result.response.status === 403 && result.data.code === "CSRF_INVALID") {
        await api.loadCsrfToken();
        result = await send();
    }
    return result;
}

function responseError(data) {
    if (Array.isArray(data.errors)) {
        return [...new Set(data.errors.map(error => error.message))].join(" ");
    }
    return data.message || "The request could not be completed.";
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
            actionButton("Edit", `Edit ${book.title}`, () => startEditing(book.bookId)),
            actionButton(statusText, `${statusText} ${book.title}`, () => changeStatus(
                book.bookId, book.status === "active" ? "inactive" : "active"
            ))
        );

        actionCell.append(actions);
        row.append(
            bookCell, element("td", book.author), element("td", book.category),
            element("td", `${book.availableCopies} available of ${book.totalCopies}`),
            element("td", book.status === "active" ? "Active" : "Archived"), actionCell
        );
        tableBody.append(row);
    }
}

async function loadList(page = 1) {
    listMessage.textContent = "Loading books...";
    const parameters = new URLSearchParams({
        search: searchInput.value.trim(), status: statusSelect.value, page: String(page)
    });

    try {
        const { response, data } = await api.get(`/api/manage/books?${parameters}`);
        if (handleAccessFailure(response, data)) return false;

        if (!response.ok || !Array.isArray(data.books) || !data.pagination) {
            throw new Error(data.message || "Could not load books.");
        }

        currentPage = data.pagination.page;
        pageCount = data.pagination.pageCount;
        renderBooks(data.books);

        const total = data.pagination.total;
        const ending = total === 1 ? "" : "s";
        listMessage.textContent = total === 0
            ? "No books match your search." : `${total} book${ending} found.`;
        pageMessage.textContent = `Page ${currentPage} of ${pageCount}`;
        return true;
    } catch (error) {
        console.error("Could not load book list:", error.message);
        listMessage.textContent = "We could not load the book list. Search again to retry.";
        return false;
    }
}

async function initialise() {
    setBusy(true);

    try {
        const { response, data } = await api.get("/api/manage/books/options");
        if (handleAccessFailure(response, data)) return;
        if (!response.ok) throw new Error("Could not load book options.");

        fillSelect(categorySelect, data.categories, "Choose a category");
        fillSelect(publisherSelect, data.publishers, "Not recorded");
        fillSelect(authorSelect, data.authors);
        fillSelect(branchSelect, data.branches, "Choose a branch");

        await api.loadCsrfToken();
        if (!await loadList(1)) return;

        bookForm.hidden = false;
        listSection.hidden = false;
        formMessage.hidden = true;
    } catch (error) {
        console.error("Book management failed:", error.message);
        message(formMessage, "We could not load book management. Please refresh the page.", "error");
    } finally { setBusy(false); }
}

async function startEditing(bookId) {
    if (busy) return;
    setBusy(true);
    createdPrompt.hidden = true;
    message(formMessage, "Loading book details...", "loading");

    try {
        const { response, data } = await api.get(`/api/manage/books/${bookId}`);
        if (handleAccessFailure(response, data)) return;

        if (!response.ok || !data.book || !Array.isArray(data.book.authorIds)) {
            throw new Error(data.message || "Could not open this book.");
        }

        const book = data.book;
        editingId = book.bookId;
        bookForm.elements.namedItem("title").value = book.title;
        bookForm.elements.namedItem("isbn").value = book.isbn;
        categorySelect.value = String(book.categoryId);
        publisherSelect.value = book.publisherId ?? "";
        yearInput.value = book.publicationYear ?? "";
        bookForm.elements.namedItem("description").value = book.description || "";

        const selectedAuthors = new Set(book.authorIds.map(String));
        for (const option of authorSelect.options) {
            option.selected = selectedAuthors.has(option.value);
        }

        heading.textContent = "Edit book";
        intro.textContent = "Update the selected title's catalogue details.";
        branchField.hidden = true;
        copiesField.hidden = true;
        cancelButton.hidden = false;
        saveButton.textContent = "Save changes";

        message(formMessage, "Editing the selected book.", "info");
        bookForm.scrollIntoView({ block: "start" });
        bookForm.elements.namedItem("title").focus({ preventScroll: true });
    } catch (error) {
        console.error("Could not open book:", error.message);
        message(formMessage, error.message, "error");
    } finally { setBusy(false); }
}

bookForm.addEventListener("submit", async event => {
    event.preventDefault();
    if (busy) return;

    // Read values before disabling the form controls.
    const formData = new FormData(bookForm);
    const values = Object.fromEntries(formData.entries());
    values.authorIds = formData.getAll("authorIds");

    const isEditing = editingId !== null;
    const path = isEditing ? `/api/manage/books/${editingId}` : "/api/manage/books";

    setBusy(true);
    createdPrompt.hidden = true;
    saveButton.textContent = "Saving...";
    message(formMessage, "Saving book details...", "loading");

    try {
        const { response, data } = await writeRequest(path, isEditing ? "PUT" : "POST", values);
        if (handleAccessFailure(response, data)) return;

        if (!response.ok) {
            message(formMessage, responseError(data), "error");
            formMessage.focus();
            return;
        }

        resetForm();
        if (data.status === "active") {
            createdLink.href = `/book-details.html?id=${encodeURIComponent(data.bookId)}`;
            createdPrompt.hidden = false;
        }

        message(formMessage, data.message, "success");
        await loadList(isEditing ? currentPage : 1);
    } catch (error) {
        console.error("Could not confirm save:", error.message);
        message(formMessage, "We could not confirm the save. Refresh the page and check the list.", "error");
    } finally {
        saveButton.textContent = editingId === null ? "Add book" : "Save changes";
        setBusy(false);
    }
});

async function changeStatus(bookId, status) {
    if (busy) return;
    setBusy(true);
    createdPrompt.hidden = true;
    message(formMessage, status === "inactive" ? "Archiving book..." : "Restoring book...", "loading");

    try {
        const { response, data } = await writeRequest(
            `/api/manage/books/${bookId}/status`, "PATCH", { status }
        );
        if (handleAccessFailure(response, data)) return;

        if (!response.ok) {
            message(formMessage, responseError(data), "error");
            return;
        }

        if (editingId === bookId) resetForm();
        message(formMessage, data.message, "success");
        await loadList(currentPage);
    } catch (error) {
        console.error("Could not change book status:", error.message);
        message(formMessage, "We could not confirm the status change. Refresh the page and check the list.", "error");
    } finally { setBusy(false); }
}

cancelButton.addEventListener("click", () => {
    if (busy) return;
    resetForm();
    formMessage.hidden = true;
    createdPrompt.hidden = true;
});

async function changePage(page) {
    if (busy) return;
    setBusy(true);
    try { await loadList(page); } finally { setBusy(false); }
}

filterForm.addEventListener("submit", event => {
    event.preventDefault();
    changePage(1);
});
previousButton.addEventListener("click", () => changePage(currentPage - 1));
nextButton.addEventListener("click", () => changePage(currentPage + 1));

initialise();