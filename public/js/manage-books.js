const bookForm = document.getElementById("book-form");
const saveButton = document.getElementById("save-book-button");
const message = document.getElementById("manage-message");

const signInPrompt = document.getElementById("sign-in-prompt");
const createdBookPrompt = document.getElementById("created-book-prompt");
const createdBookLink = document.getElementById("created-book-link");

const categorySelect = document.getElementById("categoryId");
const publisherSelect = document.getElementById("publisherId");
const authorSelect = document.getElementById("authorIds");
const branchSelect = document.getElementById("branchId");
const yearInput = document.getElementById("publicationYear");

let csrfToken = "";
let saving = false;

yearInput.max = String(new Date().getFullYear() + 1);

function showMessage(text, state) {
    message.textContent = text;
    message.dataset.state = state;
    message.hidden = false;
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

async function loadCsrfToken() {
    const response = await fetch("/api/auth/csrf-token", {
        credentials: "same-origin",
        cache: "no-store"
    });

    const data = await response.json();

    if (
        !response.ok ||
        typeof data.csrfToken !== "string"
    ) {
        throw new Error("Could not prepare the book form.");
    }

    csrfToken = data.csrfToken;
}

function handleAccessFailure(response, data) {
    if (response.status === 401) {
        bookForm.hidden = true;
        signInPrompt.hidden = false;

        showMessage(
            data.message || "Please sign in to manage books.",
            "error"
        );

        return true;
    }

    if (
        response.status === 403 &&
        data.code === "FORBIDDEN"
    ) {
        bookForm.hidden = true;

        showMessage(
            data.message ||
                "Only administrators and librarians can manage books.",
            "error"
        );

        return true;
    }

    return false;
}

async function loadForm() {
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

        if (
            !Array.isArray(data.categories) ||
            !Array.isArray(data.publishers) ||
            !Array.isArray(data.authors) ||
            !Array.isArray(data.branches)
        ) {
            throw new Error("Unexpected book options response.");
        }

        if (
            data.categories.length === 0 ||
            data.authors.length === 0 ||
            data.branches.length === 0
        ) {
            showMessage(
                "At least one category, author and active branch are needed before adding a book.",
                "error"
            );

            return;
        }

        fillSelect(
            categorySelect,
            data.categories,
            "Choose a category"
        );

        fillSelect(
            publisherSelect,
            data.publishers,
            "Not recorded"
        );

        fillSelect(authorSelect, data.authors);

        fillSelect(
            branchSelect,
            data.branches,
            "Choose a branch"
        );

        await loadCsrfToken();

        bookForm.hidden = false;
        message.hidden = true;
    } catch (error) {
        console.error("Could not load book form:", error.message);

        showMessage(
            "We could not load the form. Please refresh the page to try again.",
            "error"
        );
    }
}

async function submitBook(values) {
    const sendRequest = () => fetch("/api/manage/books", {
        method: "POST",
        credentials: "same-origin",
        headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
            "X-CSRF-Token": csrfToken
        },
        body: JSON.stringify(values)
    });

    let response = await sendRequest();
    let data = await response.json();

    if (
        response.status === 403 &&
        data.code === "CSRF_INVALID"
    ) {
        await loadCsrfToken();

        response = await sendRequest();
        data = await response.json();
    }

    return { response, data };
}

bookForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    if (saving) {
        return;
    }

    saving = true;
    saveButton.disabled = true;
    saveButton.textContent = "Adding book...";
    bookForm.setAttribute("aria-busy", "true");

    createdBookPrompt.hidden = true;
    showMessage("Adding the book and its copies...", "loading");

    try {
        const formData = new FormData(bookForm);

        const values = Object.fromEntries(formData.entries());

        values.authorIds = formData.getAll("authorIds");

        const { response, data } = await submitBook(values);

        if (handleAccessFailure(response, data)) {
            return;
        }

        if (!response.ok) {
            let errorMessage =
                data.message || "We could not add the book.";

            if (Array.isArray(data.errors)) {
                const errors = [
                    ...new Set(
                        data.errors.map((error) => error.message)
                    )
                ];

                errorMessage = errors.join(" ");
            }

            showMessage(errorMessage, "error");
            message.focus();
            return;
        }

        if (!Number.isInteger(data.bookId)) {
            throw new Error("Unexpected book creation response.");
        }

        bookForm.reset();

        createdBookLink.href =
            `/book-details.html?id=${encodeURIComponent(data.bookId)}`;

        createdBookPrompt.hidden = false;

        showMessage(data.message, "success");
        message.focus();
    } catch (error) {
        console.error("Could not add book:", error.message);

        showMessage(
            "We could not add the book. Please try again.",
            "error"
        );
    } finally {
        saving = false;
        saveButton.disabled = false;
        saveButton.textContent = "Add book";
        bookForm.removeAttribute("aria-busy");
    }
});

loadForm();