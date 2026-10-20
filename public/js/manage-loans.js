const byId = id => document.getElementById(id);

const workspace = byId("staff-workspace");
const pageMessage = byId("page-message");
const signInPrompt = byId("sign-in-prompt");

const issueForm = byId("issue-form");
const memberNumber = byId("member-number");
const branch = byId("copy-branch");
const copySearch = byId("copy-search");
const copySelect = byId("copy-id");
const copyMessage = byId("copy-message");

const filters = byId("loan-filters");
const loanSearch = byId("loan-search");
const loanStatus = byId("loan-status");
const tableBody = byId("loan-table-body");
const listMessage = byId("list-message");
const previousPage = byId("previous-page");
const nextPage = byId("next-page");

const money = new Intl.NumberFormat("en-ZA", {
    style: "currency",
    currency: "ZAR"
});

const state = {
    busy: false,
    page: 1,
    pageCount: 1,
    csrfToken: "",
    accessDenied: false
};

function showMessage(element, message, status = "info") {
    element.textContent = message;
    element.dataset.state = status;
    element.hidden = false;
}

function setBusy(value) {
    state.busy = value;

    workspace
        .querySelectorAll("input, select, button")
        .forEach(control => {
            control.disabled = value;
        });

    previousPage.disabled = value || state.page <= 1;
    nextPage.disabled = value || state.page >= state.pageCount;

    workspace.setAttribute("aria-busy", String(value));
}

function accessFailure(response, data) {
    if (
        response.status !== 401
        && !(response.status === 403 && data.code === "FORBIDDEN")
    ) {
        return false;
    }

    state.accessDenied = true;
    workspace.hidden = true;
    signInPrompt.hidden = response.status !== 401;

    showMessage(
        pageMessage,
        data.message || "Staff access is required.",
        "error"
    );

    return true;
}

function errorMessage(data) {
    if (Array.isArray(data.errors) && data.errors.length) {
        return [
            ...new Set(data.errors.map(error => error.message))
        ].join(" ");
    }

    return data.message || "The request could not be completed.";
}

async function loadCsrfToken() {
    const response = await fetch("/api/auth/csrf-token", {
        credentials: "same-origin",
        cache: "no-store"
    });

    const data = await response.json();

    if (!response.ok || typeof data.csrfToken !== "string") {
        throw new Error("Session verification failed.");
    }

    state.csrfToken = data.csrfToken;
}

async function postJson(path, values) {
    if (!state.csrfToken) {
        await loadCsrfToken();
    }

    for (let attempt = 0; attempt < 2; attempt += 1) {
        const response = await fetch(path, {
            method: "POST",
            credentials: "same-origin",
            cache: "no-store",
            headers: {
                "Content-Type": "application/json",
                "X-CSRF-Token": state.csrfToken
            },
            body: JSON.stringify(values)
        });

        const data = await response.json();

        if (
            response.status === 403
            && data.code === "CSRF_INVALID"
            && attempt === 0
        ) {
            await loadCsrfToken();
            continue;
        }

        return { response, data };
    }
}

function element(tag, value, className) {
    const node = document.createElement(tag);
    node.textContent = value;

    if (className) {
        node.className = className;
    }

    return node;
}

async function loadCopies() {
    showMessage(copyMessage, "Loading available copies...");

    copySelect.replaceChildren(
        new Option("Choose an available copy", "")
    );

    try {
        const query = new URLSearchParams({
            search: copySearch.value.trim(),
            branchId: branch.value
        });

        const response = await fetch(
            `/api/manage/loans/copies?${query}`,
            {
                credentials: "same-origin",
                cache: "no-store"
            }
        );

        const data = await response.json();

        if (accessFailure(response, data)) {
            return;
        }

        if (!response.ok || !Array.isArray(data.copies)) {
            throw new Error(errorMessage(data));
        }

        for (const copy of data.copies) {
            copySelect.add(new Option(
                `${copy.title} | ${copy.branchName} | ${copy.barcode}`,
                String(copy.copyId)
            ));
        }

        showMessage(
            copyMessage,
            data.hasMore
                ? "Showing the first 30 available copies. Refine your search to find others."
                : `${data.copies.length} available copy/copies found.`
        );
    } catch (error) {
        console.error(error);

        showMessage(
            copyMessage,
            "Copies could not be loaded. Click Find copies to retry.",
            "error"
        );
    }
}

function renderLoans(loans) {
    tableBody.replaceChildren();

    for (const loan of loans) {
        const row = document.createElement("tr");

        const bookCell = document.createElement("th");
        bookCell.scope = "row";

        bookCell.append(
            element("strong", loan.title),
            element("p", loan.barcode, "subtle")
        );

        const memberCell = document.createElement("td");

        memberCell.append(
            element("span", loan.memberName),
            element("p", loan.memberNumber, "subtle")
        );

        const statusCell = document.createElement("td");

        const statusLabels = {
            active: "Open",
            overdue: "Overdue",
            returned: "Returned"
        };

        const label = element(
            "span",
            statusLabels[loan.status] || loan.status,
            "loan-status"
        );

        label.dataset.status = loan.status;
        statusCell.append(label);

        if (loan.returnDate) {
            statusCell.append(
                element("p", loan.returnDate, "subtle")
            );
        }

        const fineCell = document.createElement("td");

        const fineValue = loan.status === "returned"
            ? loan.fineAmount
            : loan.estimatedFine;

        fineCell.append(
            element("span", money.format(Number(fineValue)))
        );

        if (loan.status !== "returned") {
            fineCell.append(
                element("p", "Estimate", "subtle")
            );
        }

        const actionCell = document.createElement("td");

        if (loan.status !== "returned") {
            const button = element(
                "button",
                "Return book",
                "button-secondary"
            );

            button.type = "button";
            button.disabled = state.busy;

            button.setAttribute(
                "aria-label",
                `Return ${loan.title} borrowed by ${loan.memberName}`
            );

            button.addEventListener("click", () => {
                returnLoan(loan.loanId);
            });

            actionCell.append(button);
        } else {
            actionCell.textContent = "Completed";
        }

        row.append(
            bookCell,
            memberCell,
            element("td", loan.issueDate),
            element("td", loan.dueDate),
            statusCell,
            fineCell,
            actionCell
        );

        tableBody.append(row);
    }
}

async function loadLoans(page = 1) {
    showMessage(listMessage, "Loading loans...");

    try {
        const query = new URLSearchParams({
            search: loanSearch.value.trim(),
            status: loanStatus.value,
            page: String(page)
        });

        const response = await fetch(
            `/api/manage/loans?${query}`,
            {
                credentials: "same-origin",
                cache: "no-store"
            }
        );

        const data = await response.json();

        if (accessFailure(response, data)) {
            return;
        }

        if (
            !response.ok
            || !Array.isArray(data.loans)
            || !data.pagination
        ) {
            throw new Error(errorMessage(data));
        }

        state.page = data.pagination.page;
        state.pageCount = data.pagination.pageCount;

        renderLoans(data.loans);

        byId("page-number").textContent =
            `Page ${state.page} of ${state.pageCount}`;

        showMessage(
            listMessage,
            `${data.pagination.total} matching loan(s).`
        );
    } catch (error) {
        console.error(error);

        showMessage(
            listMessage,
            "Loans could not be loaded. Search again to retry.",
            "error"
        );
    }
}

async function searchCopies() {
    if (state.busy) {
        return;
    }

    setBusy(true);

    try {
        await loadCopies();
    } finally {
        setBusy(false);
    }
}

async function changePage(page) {
    if (state.busy) {
        return;
    }

    setBusy(true);

    try {
        await loadLoans(page);
    } finally {
        setBusy(false);
    }
}

issueForm.addEventListener("submit", async event => {
    event.preventDefault();

    if (state.busy) {
        return;
    }

    const values = {
        memberNumber: memberNumber.value.trim(),
        copyId: copySelect.value
    };

    setBusy(true);
    showMessage(pageMessage, "Issuing book...", "loading");

    try {
        const { response, data } = await postJson(
            "/api/manage/loans",
            values
        );

        if (accessFailure(response, data)) {
            return;
        }

        if (!response.ok) {
            showMessage(pageMessage, errorMessage(data), "error");
            pageMessage.focus();
            return;
        }

        showMessage(pageMessage, data.message, "success");
        pageMessage.focus();

        loanStatus.value = "open";
        loanSearch.value = values.memberNumber;

        await Promise.all([
            loadCopies(),
            loadLoans(1)
        ]);
    } catch (error) {
        console.error(error);

        showMessage(
            pageMessage,
            "The issue could not be confirmed. Refresh and check the loan list before trying again.",
            "error"
        );
    } finally {
        setBusy(false);
    }
});

async function returnLoan(loanId) {
    if (state.busy) {
        return;
    }

    setBusy(true);

    showMessage(
        pageMessage,
        "Recording return...",
        "loading"
    );

    try {
        const { response, data } = await postJson(
            `/api/manage/loans/${loanId}/return`,
            {}
        );

        if (accessFailure(response, data)) {
            return;
        }

        if (!response.ok) {
            showMessage(pageMessage, errorMessage(data), "error");
            pageMessage.focus();
            return;
        }

        showMessage(pageMessage, data.message, "success");
        pageMessage.focus();

        await Promise.all([
            loadCopies(),
            loadLoans(state.page)
        ]);
    } catch (error) {
        console.error(error);

        showMessage(
            pageMessage,
            "The return could not be confirmed. Refresh and check the loan list before trying again.",
            "error"
        );
    } finally {
        setBusy(false);
    }
}

byId("find-copies").addEventListener(
    "click",
    searchCopies
);

branch.addEventListener("change", searchCopies);

copySearch.addEventListener("keydown", event => {
    if (event.key === "Enter") {
        event.preventDefault();
        searchCopies();
    }
});

filters.addEventListener("submit", event => {
    event.preventDefault();
    changePage(1);
});

previousPage.addEventListener("click", () => {
    changePage(state.page - 1);
});

nextPage.addEventListener("click", () => {
    changePage(state.page + 1);
});

async function initialise() {
    setBusy(true);

    try {
        const response = await fetch(
            "/api/manage/loans/options",
            {
                credentials: "same-origin",
                cache: "no-store"
            }
        );

        const data = await response.json();

        if (accessFailure(response, data)) {
            return;
        }

        if (
            !response.ok
            || !Array.isArray(data.branches)
            || !data.policies
        ) {
            throw new Error(errorMessage(data));
        }

        for (const item of data.branches) {
            branch.add(new Option(
                item.branchName,
                String(item.branchId)
            ));
        }

        const policy = data.policies;

        byId("policy-summary").textContent =
            `${policy.loanPeriodDays}-day loans; `
            + `maximum ${policy.maxActiveLoans} open loans per member. `
            + `Fines are ${money.format(Number(policy.dailyFineRate))} `
            + "per overdue calendar day. "
            + "Books are due by the end of the displayed due date in South Africa.";

        await loadCsrfToken();

        workspace.hidden = false;

        await Promise.all([
            loadCopies(),
            loadLoans(1)
        ]);

        if (!state.accessDenied) {
            pageMessage.hidden = true;
        }
    } catch (error) {
        console.error(error);

        showMessage(
            pageMessage,
            "The staff page could not be loaded. Check that the loan SQL script ran successfully, then refresh.",
            "error"
        );
    } finally {
        setBusy(false);
    }
}

initialise();