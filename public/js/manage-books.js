const bookForm = document.getElementById("book-form");
const saveButton = document.getElementById("save-book-button");
const cancelButton = document.getElementById("cancel-edit-button");

const heading = document.getElementById("manage-heading");
const intro = document.getElementById("manage-intro");
const message = document.getElementById("manage-message");

const signInPrompt = document.getElementById("sign-in-prompt");
const createdPrompt = document.getElementById("created-book-prompt");
const createdLink = document.getElementById("created-book-link");

const categorySelect = document.getElementById("categoryId");
const publisherSelect = document.getElementById("publisherId");
const authorSelect = document.getElementById("authorIds");
const branchSelect = document.getElementById("branchId");

const branchField = document.getElementById("branch-field");
const copiesField = document.getElementById("copies-field");
const yearInput = document.getElementById("publicationYear");

const listSection = document.getElementById("book-list-section");
const filterForm = document.getElementById("book-filters");
const searchInput = document.getElementById("manage-search-term");
const statusSelect = document.getElementById("manage-status");

const tableBody = document.getElementById("book-table-body");
const listMessage = document.getElementById("book-list-message");
const pageMessage = document.getElementById("page-message");

const previousButton = document.getElementById("previous-page");
const nextButton = document.getElementById("next-page");

let csrfToken = "";
let editingId = null;
let busy = false;
let currentPage = 1;
let pageCount = 1;

yearInput.max = String(new Date().getFullYear() + 1);

function showMessage(text, state) {
    message.textContent = text;
    message.dataset.state = state;
    message.hidden = false;
}

function setBusy(value) {
    busy = value;

    for (const control of bookForm.elements) {
        const stockControl = [
            "branchId",
            "initialCopies"
        ].includes(control.name);

        control.disabled =
            value || (editingId !== null && stockControl);
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

function resetForm() {
    editingId = null;

    bookForm.reset();

    heading.textContent = "Add a book";
    intro.textContent =
        "Add a title and its first copies to a library branch.";

    branchField.hidden = false;
    copiesField.hidden = false;
    cancelButton.hidden = true;
    saveButton.textContent = "Add book";

    setBusy(busy);
}

function fillSelect(select, items, placeholder = null) {
    select.replaceChildren();

    if (placeholder !== null) {
        const option = document.createElement("option");
        option.value = "";
        option.textContent = placeholder;
        select.append(option);
    }

    for (const item of items) {
        const option = document.createElement("option");

        option.value = String(item.id);
        option.textContent = item.name;

        select.append(option);
    }
}

function handleAccessFailure(response, data) {
    if (
        response.status !== 401 &&
        !(response.status === 403 && data.code === "FORBIDDEN")
    ) {
        return false;
    }

    bookForm.hidden = true;
    listSection.hidden = true;
    createdPrompt.hidden = true;

    signInPrompt.hidden = response.status !== 401;

    showMessage(
        data.message || "You do not have access to manage books.",
        "error"
    );

    return true;
}

async function loadCsrfToken() {
    const response = await fetch("/api/auth/csrf-token", {
        credentials: "same-origin",
        cache: "no-store"
    });

    const data = await response.json();

    if (!response.ok || typeof data.csrfToken !== "string") {
        throw new Error("Could not prepare the form.");
    }

    csrfToken = data.csrfToken;
}

async function writeRequest(path, method, values) {
    const send = () => fetch(path, {
        method,
        credentials: "same-origin",
        headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
            "X-CSRF-Token": csrfToken
        },
        body: JSON.stringify(values)
    });

    let response = await send();
    let data = await response.json();

    if (
        response.status === 403 &&
        data.code === "CSRF_INVALID"
    ) {
        await loadCsrfToken();

        response = await send();
        data = await response.json();
    }

    return { response, data };
}

function responseError(data) {
    if (Array.isArray(data.errors)) {
        return [
            ...new Set(data.errors.map((error) => error.message))
        ].join(" ");
    }

    return data.message || "The request could not be completed.";
}

function textElement(tag, value, className = "") {
    const element = document.createElement(tag);

    element.textContent = value;

    if (className) {
        element.className = className;
    }

    return element;
}

function renderBooks(books) {
    tableBody.replaceChildren();

    for (const book of books) {
        const row = document.createElement("tr");

        const bookCell = document.createElement("th");
        bookCell.scope = "row";

        bookCell.append(
            textElement("strong", book.title),
            textElement("p", `ISBN: ${book.isbn}`, "book-isbn")
        );

        const actionCell = document.createElement("td");
        const actions = document.createElement("div");
        actions.className = "manage-actions";

        const editButton = textElement("button", "Edit");
        editButton.type = "button";
        editButton.className = "button-secondary";
        editButton.disabled = busy;

        editButton.setAttribute(
            "aria-label",
            `Edit ${book.title}`
        );

        editButton.addEventListener("click", () => {
            startEditing(book.bookId);
        });

        const statusButton = textElement(
            "button",
            book.status === "active" ? "Archive" : "Restore"
        );

        statusButton.type = "button";
        statusButton.className = "button-secondary";
        statusButton.disabled = busy;

        statusButton.setAttribute(
            "aria-label",
            `${statusButton.textContent} ${book.title}`
        );

        statusButton.addEventListener("click", () => {
            changeStatus(
                book.bookId,
                book.status === "active" ? "inactive" : "active"
            );
        });

        actions.append(editButton, statusButton);
        actionCell.append(actions);

        row.append(
            bookCell,
            textElement("td", book.author),
            textElement("td", book.category),
            textElement(
                "td",
                `${book.availableCopies} available of ${book.totalCopies}`
            ),
            textElement(
                "td",
                book.status === "active" ? "Active" : "Archived"
            ),
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
        const response = await fetch(
            `/api/manage/books?${parameters.toString()}`,
            {
                credentials: "same-origin",
                cache: "no-store"
            }
        );

        const data = await response.json();

        if (handleAccessFailure(response, data)) {
            return false;
        }

        if (
            !response.ok ||
            !Array.isArray(data.books) ||
            !data.pagination
        ) {
            throw new Error(data.message || "Could not load books.");
        }

        currentPage = data.pagination.page;
        pageCount = data.pagination.pageCount;

        renderBooks(data.books);

        const total = data.pagination.total;
        const ending = total === 1 ? "" : "s";

        listMessage.textContent = total === 0
            ? "No books match your search."
            : `${total} book${ending} found.`;

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
        const response = await fetch("/api/manage/books/options", {
            credentials: "same-origin",
            cache: "no-store"
        });

        const data = await response.json();

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

        await loadCsrfToken();

        if (!await loadList(1)) {
            return;
        }

        bookForm.hidden = false;
        listSection.hidden = false;
        message.hidden = true;
    } catch (error) {
        console.error("Book management failed:", error.message);

        showMessage(
            "We could not load book management. Please refresh the page.",
            "error"
        );
    } finally {
        setBusy(false);
    }
}

async function startEditing(bookId) {
    if (busy) {
        return;
    }

    setBusy(true);
    createdPrompt.hidden = true;

    showMessage("Loading book details...", "loading");

    try {
        const response = await fetch(`/api/manage/books/${bookId}`, {
            credentials: "same-origin",
            cache: "no-store"
        });

        const data = await response.json();

        if (handleAccessFailure(response, data)) {
            return;
        }

        if (
            !response.ok ||
            !data.book ||
            !Array.isArray(data.book.authorIds)
        ) {
            throw new Error(data.message || "Could not open this book.");
        }

        const book = data.book;
        editingId = book.bookId;

        bookForm.elements.namedItem("title").value = book.title;
        bookForm.elements.namedItem("isbn").value = book.isbn;

        categorySelect.value = String(book.categoryId);
        publisherSelect.value = book.publisherId ?? "";
        yearInput.value = book.publicationYear ?? "";

        bookForm.elements.namedItem("description").value =
            book.description || "";

        const selectedAuthors = new Set(
            book.authorIds.map(String)
        );

        for (const option of authorSelect.options) {
            option.selected = selectedAuthors.has(option.value);
        }

        heading.textContent = "Edit book";
        intro.textContent =
            "Update the selected title's catalogue details.";

        branchField.hidden = true;
        copiesField.hidden = true;
        cancelButton.hidden = false;
        saveButton.textContent = "Save changes";

        showMessage("Editing the selected book.", "info");

        bookForm.scrollIntoView({ block: "start" });

        bookForm.elements.namedItem("title").focus({
            preventScroll: true
        });
    } catch (error) {
        console.error("Could not open book:", error.message);
        showMessage(error.message, "error");
    } finally {
        setBusy(false);
    }
}

bookForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    if (busy) {
        return;
    }

    // Read values before disabling the form controls.
    const formData = new FormData(bookForm);
    const values = Object.fromEntries(formData.entries());

    values.authorIds = formData.getAll("authorIds");

    const isEditing = editingId !== null;

    const path = isEditing
        ? `/api/manage/books/${editingId}`
        : "/api/manage/books";

    setBusy(true);
    createdPrompt.hidden = true;

    saveButton.textContent = "Saving...";
    showMessage("Saving book details...", "loading");

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
            showMessage(responseError(data), "error");
            message.focus();
            return;
        }

        resetForm();

        if (data.status === "active") {
            createdLink.href =
                `/book-details.html?id=${encodeURIComponent(data.bookId)}`;

            createdPrompt.hidden = false;
        }

        showMessage(data.message, "success");

        await loadList(isEditing ? currentPage : 1);
    } catch (error) {
        console.error("Could not confirm save:", error.message);

        showMessage(
            "We could not confirm the save. Refresh the page and check the list.",
            "error"
        );
    } finally {
        saveButton.textContent =
            editingId === null ? "Add book" : "Save changes";

        setBusy(false);
    }
});

async function changeStatus(bookId, status) {
    if (busy) {
        return;
    }

    setBusy(true);
    createdPrompt.hidden = true;

    showMessage(
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
            showMessage(responseError(data), "error");
            return;
        }

        if (editingId === bookId) {
            resetForm();
        }

        showMessage(data.message, "success");

        await loadList(currentPage);
    } catch (error) {
        console.error("Could not change book status:", error.message);

        showMessage(
            "We could not confirm the status change. Refresh the page and check the list.",
            "error"
        );
    } finally {
        setBusy(false);
    }
}

cancelButton.addEventListener("click", () => {
    if (busy) {
        return;
    }

    resetForm();
    message.hidden = true;
    createdPrompt.hidden = true;
});

async function changePage(page) {
    if (busy) {
        return;
    }

    setBusy(true);

    try {
        await loadList(page);
    } finally {
        setBusy(false);
    }
}

filterForm.addEventListener("submit", (event) => {
    event.preventDefault();
    changePage(1);
});

previousButton.addEventListener("click", () => {
    changePage(currentPage - 1);
});

nextButton.addEventListener("click", () => {
    changePage(currentPage + 1);
});

initialise();