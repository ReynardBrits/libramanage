const { byId, money, message, element, createApi } = window.LibraUI;
const api = createApi();

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

const state = {
    busy: false, page: 1, pageCount: 1, accessDenied: false
};

function setBusy(value) {
    state.busy = value;
    workspace.querySelectorAll("input, select, button").forEach(control => {
        control.disabled = value;
    });
    previousPage.disabled = value || state.page <= 1;
    nextPage.disabled = value || state.page >= state.pageCount;
    workspace.setAttribute("aria-busy", String(value));
}

function accessFailure(response, data) {
    if (response.status !== 401
        && !(response.status === 403 && data.code === "FORBIDDEN")) return false;

    state.accessDenied = true;
    workspace.hidden = true;
    signInPrompt.hidden = response.status !== 401;
    message(pageMessage, data.message || "Staff access is required.", "error");
    return true;
}

function errorMessage(data) {
    if (Array.isArray(data.errors) && data.errors.length) {
        return [...new Set(data.errors.map(error => error.message))].join(" ");
    }
    return data.message || "The request could not be completed.";
}

async function loadCopies() {
    message(copyMessage, "Loading available copies...");
    copySelect.replaceChildren(new Option("Choose an available copy", ""));

    try {
        const query = new URLSearchParams({
            search: copySearch.value.trim(), branchId: branch.value
        });
        const { response, data } = await api.get(`/api/manage/loans/copies?${query}`);

        if (accessFailure(response, data)) return;
        if (!response.ok || !Array.isArray(data.copies)) {
            throw new Error(errorMessage(data));
        }

        for (const copy of data.copies) {
            copySelect.add(new Option(
                `${copy.title} | ${copy.branchName} | ${copy.barcode}`, String(copy.copyId)
            ));
        }

        message(copyMessage, data.hasMore
            ? "Showing the first 30 available copies. Refine your search to find others."
            : `${data.copies.length} available copy/copies found.`);
    } catch (error) {
        console.error(error);
        message(copyMessage, "Copies could not be loaded. Click Find copies to retry.", "error");
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
        const label = element("span", {
            active: "Open", overdue: "Overdue", returned: "Returned"
        }[loan.status] || loan.status, "loan-status");

        label.dataset.status = loan.status;
        statusCell.append(label);
        if (loan.returnDate) {
            statusCell.append(element("p", loan.returnDate, "subtle"));
        }

        const fineCell = document.createElement("td");
        fineCell.append(element("span", money.format(Number(
            loan.status === "returned" ? loan.fineAmount : loan.estimatedFine
        ))));
        if (loan.status !== "returned") {
            fineCell.append(element("p", "Estimate", "subtle"));
        }

        const actionCell = document.createElement("td");
        if (loan.status !== "returned") {
            const button = element("button", "Return book", "button-secondary");
            button.type = "button";
            button.disabled = state.busy;
            button.setAttribute(
                "aria-label", `Return ${loan.title} borrowed by ${loan.memberName}`
            );
            button.addEventListener("click", () => saveLoan("return", {
                loanId: loan.loanId
            }));
            actionCell.append(button);
        } else {
            actionCell.textContent = "Completed";
        }

        row.append(
            bookCell, memberCell, element("td", loan.issueDate),
            element("td", loan.dueDate), statusCell, fineCell, actionCell
        );
        tableBody.append(row);
    }
}

async function loadLoans(page = 1) {
    message(listMessage, "Loading loans...");

    try {
        const query = new URLSearchParams({
            search: loanSearch.value.trim(), status: loanStatus.value, page: String(page)
        });
        const { response, data } = await api.get(`/api/manage/loans?${query}`);

        if (accessFailure(response, data)) return;
        if (!response.ok || !Array.isArray(data.loans) || !data.pagination) {
            throw new Error(errorMessage(data));
        }

        state.page = data.pagination.page;
        state.pageCount = data.pagination.pageCount;
        renderLoans(data.loans);
        byId("page-number").textContent = `Page ${state.page} of ${state.pageCount}`;
        message(listMessage, `${data.pagination.total} matching loan(s).`);
    } catch (error) {
        console.error(error);
        message(listMessage, "Loans could not be loaded. Search again to retry.", "error");
    }
}

async function searchCopies() {
    if (state.busy) return;
    setBusy(true);
    try { await loadCopies(); } finally { setBusy(false); }
}

async function changePage(page) {
    if (state.busy) return;
    setBusy(true);
    try { await loadLoans(page); } finally { setBusy(false); }
}

issueForm.addEventListener("submit", event => {
    event.preventDefault();
    return saveLoan("issue", {
        memberNumber: memberNumber.value.trim(), copyId: copySelect.value
    });
});

async function saveLoan(action, values) {
    if (state.busy) return;

    const issuing = action === "issue";
    const path = issuing
        ? "/api/manage/loans"
        : `/api/manage/loans/${values.loanId}/return`;

    setBusy(true);
    message(pageMessage, issuing ? "Issuing book..." : "Recording return...", "loading");

    try {
        const { response, data } = await api.post(path, issuing ? values : {});
        if (accessFailure(response, data)) return;

        if (!response.ok) {
            message(pageMessage, errorMessage(data), "error");
            pageMessage.focus();
            return;
        }

        message(pageMessage, data.message, "success");
        pageMessage.focus();

        if (issuing) {
            loanStatus.value = "open";
            loanSearch.value = values.memberNumber;
        }

        await Promise.all([loadCopies(), loadLoans(issuing ? 1 : state.page)]);
    } catch (error) {
        console.error(error);
        message(
            pageMessage,
            `The ${issuing ? "issue" : "return"} could not be confirmed. Refresh and check the loan list before trying again.`,
            "error"
        );
    } finally { setBusy(false); }
}

byId("find-copies").addEventListener("click", searchCopies);
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

previousPage.addEventListener("click", () => changePage(state.page - 1));
nextPage.addEventListener("click", () => changePage(state.page + 1));

async function initialise() {
    setBusy(true);

    try {
        const { response, data } = await api.get("/api/manage/loans/options");
        if (accessFailure(response, data)) return;

        if (!response.ok || !Array.isArray(data.branches) || !data.policies) {
            throw new Error(errorMessage(data));
        }

        for (const item of data.branches) {
            branch.add(new Option(item.branchName, String(item.branchId)));
        }

        const policy = data.policies;
        byId("policy-summary").textContent =
            `${policy.loanPeriodDays}-day loans; maximum ${policy.maxActiveLoans} open loans per member. `
            + `Fines are ${money.format(Number(policy.dailyFineRate))} per overdue calendar day. `
            + "Books are due by the end of the displayed due date in South Africa.";

        await api.loadCsrfToken();
        workspace.hidden = false;
        await Promise.all([loadCopies(), loadLoans(1)]);
        if (!state.accessDenied) pageMessage.hidden = true;
    } catch (error) {
        console.error(error);
        message(
            pageMessage,
            "The staff page could not be loaded. Check that the loan SQL script ran successfully, then refresh.",
            "error"
        );
    } finally { setBusy(false); }
}

initialise();