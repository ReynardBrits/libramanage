const byId = id => document.getElementById(id);

const loginForm = byId("login-form");
const accountPanel = byId("account-panel");
const accountMessage = byId("account-message");
const logoutButton = byId("logout-button");

const borrowingPanel = byId("borrowing-panel");
const borrowingContent = byId("borrowing-content");
const borrowingMessage = byId("borrowing-message");
const loanStatus = byId("my-loan-status");

const money = new Intl.NumberFormat("en-ZA", {
    style: "currency",
    currency: "ZAR"
});

const dates = new Intl.DateTimeFormat("en-ZA", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC"
});

const state = {
    user: null,
    csrfToken: "",
    authBusy: false,
    borrowingBusy: false,
    version: 0,
    controller: null,
    loanPage: 1,
    loanPageCount: 1,
    finePage: 1,
    finePageCount: 1
};

function message(target, text, status = "info") {
    target.textContent = text;
    target.dataset.state = status;
    target.hidden = false;
}

function setAuthBusy(value) {
    state.authBusy = value;

    Array.from(loginForm.elements).forEach(control => {
        control.disabled = value;
    });

    logoutButton.disabled = value;
}

function setBorrowingBusy(value) {
    state.borrowingBusy = value;

    borrowingPanel
        .querySelectorAll("select, button")
        .forEach(control => {
            control.disabled = value || !state.user;
        });

    byId("loans-previous").disabled =
        value || state.loanPage <= 1;

    byId("loans-next").disabled =
        value || state.loanPage >= state.loanPageCount;

    byId("fines-previous").disabled =
        value || state.finePage <= 1;

    byId("fines-next").disabled =
        value || state.finePage >= state.finePageCount;

    borrowingPanel.setAttribute("aria-busy", String(value));
}

function clearAccount() {
    state.user = null;
    state.version += 1;

    state.controller?.abort();
    state.controller = null;

    state.loanPage = 1;
    state.loanPageCount = 1;
    state.finePage = 1;
    state.finePageCount = 1;

    loanStatus.value = "all";

    accountPanel.hidden = true;
    borrowingPanel.hidden = true;
    borrowingContent.hidden = true;

    byId("my-loan-rows").replaceChildren();
    byId("my-fine-rows").replaceChildren();

    const profileFields = [
        "profile-name",
        "profile-email",
        "profile-role",
        "profile-number",
        "profile-status"
    ];

    for (const id of profileFields) {
        byId(id).textContent = "";
    }

    const summaryFields = [
        "open-count",
        "overdue-count",
        "outstanding-balance"
    ];

    for (const id of summaryFields) {
        byId(id).textContent = "—";
    }

    byId("staff-books-link").hidden = true;
    byId("staff-loans-link").hidden = true;

    setBorrowingBusy(false);
}

function showSignIn(text, status = "info") {
    clearAccount();

    loginForm.hidden = false;
    byId("login-password").value = "";

    if (text) {
        message(accountMessage, text, status);
    } else {
        accountMessage.hidden = true;
    }
}

function showAccount(user) {
    if (!user || !Number.isInteger(user.userId)) {
        throw new Error("Invalid account response.");
    }

    clearAccount();
    state.user = user;

    loginForm.hidden = true;
    accountPanel.hidden = false;

    byId("profile-name").textContent =
        `${user.firstName} ${user.lastName}`;

    byId("profile-email").textContent = user.email;

    const roles = {
        member: "Member",
        librarian: "Librarian",
        admin: "Administrator"
    };

    byId("profile-role").textContent =
        roles[user.roleName] || user.roleName;

    byId("profile-number").textContent =
        user.memberNumber || "No membership";

    byId("profile-status").textContent = user.memberNumber
        ? (
            user.borrowingStatus === "suspended"
                ? "Suspended"
                : "Active"
        )
        : "No membership";

    const staff = ["admin", "librarian"].includes(
        user.roleName
    );

    byId("staff-books-link").hidden = !staff;
    byId("staff-loans-link").hidden = !staff;

    borrowingPanel.hidden = !user.memberNumber;
}

async function loadCsrfToken() {
    const response = await fetch("/api/auth/csrf-token", {
        credentials: "same-origin",
        cache: "no-store"
    });

    const data = await response.json();

    if (!response.ok || typeof data.csrfToken !== "string") {
        throw new Error("Your session could not be verified.");
    }

    state.csrfToken = data.csrfToken;
}

async function postAuth(path, values) {
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

        if (response.status === 403 && attempt === 0) {
            await loadCsrfToken();
            continue;
        }

        return {
            response,
            data
        };
    }
}

function element(tag, text, className) {
    const node = document.createElement(tag);
    node.textContent = text;

    if (className) {
        node.className = className;
    }

    return node;
}

function dateLabel(value) {
    if (!value) {
        return "—";
    }

    return dates.format(
        new Date(`${value}T00:00:00Z`)
    );
}

function statusLabel(status) {
    const labels = {
        active: "Open",
        overdue: "Overdue",
        returned: "Returned",
        unpaid: "Unpaid",
        partially_paid: "Partially paid",
        paid: "Paid"
    };

    const node = element(
        "span",
        labels[status] || status,
        "account-status"
    );

    node.dataset.status = status;

    return node;
}

function emptyRow(body, text) {
    const row = document.createElement("tr");
    const cell = element("td", text);

    cell.colSpan = 6;

    row.append(cell);
    body.append(row);
}

function renderLoans(loans) {
    const body = byId("my-loan-rows");
    body.replaceChildren();

    if (!loans.length) {
        return emptyRow(
            body,
            "No loans match this filter."
        );
    }

    for (const loan of loans) {
        const row = document.createElement("tr");
        const book = document.createElement("th");

        book.scope = "row";

        book.append(
            element("strong", loan.title),

            element(
                "p",
                `Loan #${loan.loanId} · ${loan.branchName}`,
                "account-subtle"
            ),

            element(
                "p",
                loan.barcode,
                "account-subtle"
            )
        );

        const status = document.createElement("td");
        status.append(statusLabel(loan.status));

        const fine = document.createElement("td");

        const fineValue = loan.status === "returned"
            ? loan.fineAmount
            : loan.estimatedFine;

        fine.append(
            element("span", money.format(Number(fineValue)))
        );

        if (loan.status !== "returned") {
            fine.append(
                element("p", "Estimate", "account-subtle")
            );
        }

        row.append(
            book,
            element("td", dateLabel(loan.issueDate)),
            element("td", dateLabel(loan.dueDate)),
            element("td", dateLabel(loan.returnDate)),
            status,
            fine
        );

        body.append(row);
    }
}

function renderFines(fines) {
    const body = byId("my-fine-rows");
    body.replaceChildren();

    if (!fines.length) {
        return emptyRow(
            body,
            "You have no recorded fines."
        );
    }

    for (const fine of fines) {
        const row = document.createElement("tr");
        const book = document.createElement("th");

        book.scope = "row";

        book.append(
            element("strong", fine.title),

            element(
                "p",
                `Fine #${fine.fineId}`,
                "account-subtle"
            )
        );

        const status = document.createElement("td");
        status.append(statusLabel(fine.status));

        row.append(
            book,
            element("td", fine.overdueDays),
            element("td", money.format(Number(fine.fineAmount))),
            element("td", money.format(Number(fine.paidAmount))),
            element("td", money.format(Number(fine.balance))),
            status
        );

        body.append(row);
    }
}

async function loadBorrowing() {
    if (!state.user?.memberNumber || state.borrowingBusy) {
        return;
    }

    const userId = state.user.userId;
    const version = ++state.version;

    state.controller?.abort();
    state.controller = new AbortController();

    setBorrowingBusy(true);
    borrowingContent.hidden = true;

    message(
        borrowingMessage,
        "Loading your loans and fines...",
        "loading"
    );

    try {
        const query = new URLSearchParams({
            loanStatus: loanStatus.value,
            loanPage: String(state.loanPage),
            finePage: String(state.finePage)
        });

        const response = await fetch(
            `/api/my-borrowing?${query}`,
            {
                credentials: "same-origin",
                cache: "no-store",
                signal: state.controller.signal
            }
        );

        const data = await response.json();

        if (
            version !== state.version
            || userId !== state.user?.userId
        ) {
            return;
        }

        if (response.status === 401) {
            state.csrfToken = "";

            showSignIn(
                "Your session expired. Please sign in again.",
                "error"
            );

            return;
        }

        if (!response.ok) {
            throw new Error(
                data.message
                || "Your borrowing records could not be loaded."
            );
        }

        if (data.userId !== userId) {
            showSignIn(
                "Your signed-in account changed. Refresh this page.",
                "error"
            );

            return;
        }

        if (
            !data.membership
            || !data.summary
            || !Array.isArray(data.loans?.items)
            || !Array.isArray(data.fines?.items)
            || !data.loans.pagination
            || !data.fines.pagination
        ) {
            throw new Error(
                "The borrowing response was incomplete."
            );
        }

        byId("open-count").textContent =
            data.summary.openLoans;

        byId("overdue-count").textContent =
            data.summary.overdueLoans;

        byId("outstanding-balance").textContent =
            money.format(
                Number(data.summary.outstandingBalance)
            );

        byId("profile-status").textContent =
            data.membership.borrowingStatus === "suspended"
                ? "Suspended"
                : "Active";

        renderLoans(data.loans.items);
        renderFines(data.fines.items);

        state.loanPage = data.loans.pagination.page;
        state.loanPageCount = data.loans.pagination.pageCount;

        state.finePage = data.fines.pagination.page;
        state.finePageCount = data.fines.pagination.pageCount;

        byId("loans-page").textContent =
            `Page ${state.loanPage} of ${state.loanPageCount}`
            + ` · ${data.loans.pagination.total} loan(s)`;

        byId("fines-page").textContent =
            `Page ${state.finePage} of ${state.finePageCount}`
            + ` · ${data.fines.pagination.total} fine(s)`;

        borrowingContent.hidden = false;
        borrowingMessage.hidden = true;
    } catch (error) {
        if (
            error.name === "AbortError"
            || version !== state.version
        ) {
            return;
        }

        console.error(error);

        message(
            borrowingMessage,
            `${error.message} Use Refresh records to retry.`,
            "error"
        );
    } finally {
        if (version === state.version) {
            setBorrowingBusy(false);
        }
    }
}

loginForm.addEventListener("submit", async event => {
    event.preventDefault();

    if (state.authBusy) {
        return;
    }

    const values = {
        email: byId("login-email").value.trim(),
        password: byId("login-password").value
    };

    setAuthBusy(true);

    message(
        accountMessage,
        "Signing in...",
        "loading"
    );

    try {
        const { response, data } = await postAuth(
            "/api/auth/login",
            values
        );

        if (!response.ok) {
            const details = Array.isArray(data.errors)
                ? data.errors
                    .map(error => error.message)
                    .join(" ")
                : "";

            message(
                accountMessage,
                details || data.message || "Sign-in failed.",
                "error"
            );

            accountMessage.focus();
            return;
        }

        state.csrfToken = data.csrfToken;
        byId("login-password").value = "";

        showAccount(data.user);

        message(
            accountMessage,
            "You are signed in.",
            "success"
        );

        await loadBorrowing();
    } catch (error) {
        console.error(error);

        showSignIn(
            "Sign-in could not be confirmed. Refresh the page and try again.",
            "error"
        );
    } finally {
        setAuthBusy(false);
    }
});

logoutButton.addEventListener("click", async () => {
    if (state.authBusy) {
        return;
    }

    setAuthBusy(true);
    clearAccount();

    loginForm.hidden = true;

    message(
        accountMessage,
        "Signing out...",
        "loading"
    );

    try {
        const { response, data } = await postAuth(
            "/api/auth/logout",
            {}
        );

        if (!response.ok) {
            throw new Error(
                data.message || "Sign-out failed."
            );
        }

        state.csrfToken = "";

        showSignIn(
            "You have signed out.",
            "success"
        );
    } catch (error) {
        console.error(error);

        showSignIn(
            "Sign-out could not be confirmed. Please refresh and try again.",
            "error"
        );
    } finally {
        setAuthBusy(false);
    }
});

byId("reload-borrowing").addEventListener(
    "click",
    loadBorrowing
);

byId("loan-filter-form").addEventListener(
    "submit",
    event => {
        event.preventDefault();

        if (state.borrowingBusy) {
            return;
        }

        state.loanPage = 1;
        loadBorrowing();
    }
);

const paginationButtons = [
    ["loans-previous", "loanPage", -1],
    ["loans-next", "loanPage", 1],
    ["fines-previous", "finePage", -1],
    ["fines-next", "finePage", 1]
];

for (const [id, key, change] of paginationButtons) {
    byId(id).addEventListener("click", () => {
        if (state.borrowingBusy) {
            return;
        }

        state[key] += change;
        loadBorrowing();
    });
}

async function initialise() {
    if (state.authBusy) {
        return;
    }

    setAuthBusy(true);
    clearAccount();

    loginForm.hidden = true;

    message(
        accountMessage,
        "Checking your session...",
        "loading"
    );

    try {
        await loadCsrfToken();

        const response = await fetch("/api/auth/me", {
            credentials: "same-origin",
            cache: "no-store"
        });

        const data = await response.json();

        if (response.status === 401) {
            showSignIn();
            return;
        }

        if (!response.ok) {
            throw new Error(
                data.message || "Account lookup failed."
            );
        }

        showAccount(data.user);
        accountMessage.hidden = true;

        await loadBorrowing();
    } catch (error) {
        console.error(error);

        showSignIn(
            "Your account could not be loaded. Please refresh and try again.",
            "error"
        );
    } finally {
        setAuthBusy(false);
    }
}

window.addEventListener("pageshow", event => {
    if (event.persisted) {
        initialise();
    }
});

document.addEventListener("visibilitychange", () => {
    if (
        !document.hidden
        && state.user
        && !state.authBusy
    ) {
        initialise();
    }
});

initialise();