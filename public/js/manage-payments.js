const { byId, money, message, element, requestJson } = window.LibraUI;
const workspace = byId("staff-workspace");
const pageMessage = byId("page-message");
const filters = byId("fine-filters");
const amountInput = byId("payment-amount");
const recordButton = byId("record-payment");
const finePanel = byId("fine-panel");
const receipt = byId("receipt");

const statusLabels = {
    unpaid: "Unpaid", partially_paid: "Partially paid", paid: "Paid"
};

const state = {
    run: null, busy: false, fine: null, pending: null,
    page: 1, pageCount: 1, paymentPage: 1, paymentPageCount: 1,
    filters: { search: "", status: "outstanding" }
};

function emptyRow(body, columns, text) {
    const row = document.createElement("tr");
    const cell = element("td", text);
    cell.colSpan = columns;
    row.append(cell);
    body.replaceChildren(row);
}

function setBusy(value) {
    state.busy = value;
    workspace.setAttribute("aria-busy", String(value));
    workspace.querySelectorAll("input, select, button").forEach(control => {
        control.disabled = value;
    });
    filters.querySelectorAll("input, select, button").forEach(control => {
        control.disabled = value || Boolean(state.pending);
    });
    workspace.querySelectorAll(".view-fine").forEach(button => {
        button.disabled = value || Boolean(state.pending);
    });

    byId("previous-page").disabled = value || Boolean(state.pending) || state.page <= 1;
    byId("next-page").disabled = value || Boolean(state.pending) || state.page >= state.pageCount;
    byId("previous-payment-page").disabled = value || state.paymentPage <= 1;
    byId("next-payment-page").disabled = value || state.paymentPage >= state.paymentPageCount;
    amountInput.disabled = value || Boolean(state.pending) || !state.fine || state.fine.balance === "0.00";
    recordButton.disabled = value || !state.fine || (!state.pending && state.fine.balance === "0.00");
    recordButton.textContent = state.pending ? "Retry payment" : "Record payment";
    byId("pending-message").hidden = !state.pending;

    if (state.pending) {
        amountInput.value = state.pending.amount;
        message(byId("pending-message"),
            "This submission is awaiting confirmation. Use Retry payment to check or record it before starting another payment.");
    }
}

function assertCurrent(run) {
    if (run !== state.run) {
        throw Object.assign(new Error("The page changed."), { name: "AbortError" });
    }
}

async function api(run, path, options = {}) {
    const { response, data } = await requestJson(path, {
        ...options, signal: run.controller.signal
    });
    assertCurrent(run);

    if (!response.ok) {
        const text = data.errors?.length
            ? data.errors.map(error => error.message).join(" ")
            : data.message || "The request could not be completed.";
        throw Object.assign(new Error(text), {
            status: response.status, code: data.code
        });
    }

    return data;
}

async function checkStaff(run) {
    const data = await api(run, "/api/auth/me");

    if (!Number.isInteger(data.user?.userId)
        || !["admin", "librarian"].includes(data.user.roleName)) {
        throw Object.assign(new Error("Only administrators and librarians can manage payments."), {
            status: 403, code: "FORBIDDEN"
        });
    }

    if (run.userId !== null && run.userId !== data.user.userId) {
        throw Object.assign(new Error("The signed-in account changed. Reload this page to continue."), {
            status: 401
        });
    }

    run.userId = data.user.userId;
}

function clearView() {
    workspace.hidden = true;
    finePanel.hidden = true;
    receipt.hidden = true;
    byId("fine-rows").replaceChildren();
    byId("payment-rows").replaceChildren();
    state.fine = null;
}

function handleError(run, error) {
    if (run !== state.run || error.name === "AbortError") return;

    if (error.status === 401 || (error.status === 403 && error.code === "FORBIDDEN")) {
        clearView();
        byId("sign-in-prompt").hidden = error.status !== 401;
    }

    message(pageMessage, error.message || "The page could not be loaded. Refresh to try again.", "error");
    pageMessage.focus();
}

async function operate(work) {
    if (state.busy) return;
    const run = state.run;
    setBusy(true);

    try {
        await work(run);
    } catch (error) {
        handleError(run, error);
    } finally {
        if (run === state.run) setBusy(false);
    }
}

function cents(value) {
    const match = /^(0|[1-9]\d{0,7})(?:\.(\d{1,2}))?$/.exec(value.trim());
    if (!match) {
        throw new Error("Enter an amount such as 2.00, using at most two decimal places.");
    }

    const result = BigInt(match[1]) * 100n
        + BigInt((match[2] || "").padEnd(2, "0"));

    if (result < 1n) throw new Error("The payment must be greater than zero.");
    return result;
}

function normaliseAmount(value) {
    const amount = cents(value);
    return `${amount / 100n}.${String(amount % 100n).padStart(2, "0")}`;
}

function storageKey(run) {
    return `libramanage.pending-payment.${run.userId}`;
}

function restorePending(run) {
    const saved = sessionStorage.getItem(storageKey(run));
    if (!saved) return null;

    const payment = JSON.parse(saved);
    if (!Number.isInteger(payment.fineId) || payment.fineId < 1
        || typeof payment.amount !== "string"
        || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(payment.requestKey)) {
        throw new Error("Saved payment details are invalid. Check the payment history before clearing site data.");
    }

    payment.amount = normaliseAmount(payment.amount);
    return payment;
}

function clearPending(run) {
    sessionStorage.removeItem(storageKey(run));
    state.pending = null;
}

async function loadList(run, page = 1) {
    message(byId("list-message"), "Loading fines...");
    const query = new URLSearchParams({ ...state.filters, page: String(page) });
    const data = await api(run, `/api/manage/payments?${query}`);
    state.page = data.pagination.page;
    state.pageCount = data.pagination.pageCount;

    const body = byId("fine-rows");
    body.replaceChildren();

    for (const fine of data.items) {
        const row = document.createElement("tr");
        const book = document.createElement("th");
        book.scope = "row";
        book.append(element("strong", fine.title), element("p", fine.barcode, "subtle"));

        const member = document.createElement("td");
        member.append(
            element("span", fine.memberName),
            element("p", fine.memberNumber, "subtle")
        );

        const status = element("span", statusLabels[fine.status] || fine.status, "payment-status");
        status.dataset.status = fine.status;
        const statusCell = document.createElement("td");
        statusCell.append(status);

        const action = document.createElement("td");
        const button = element("button", "View fine", "button-secondary view-fine");
        button.type = "button";
        button.setAttribute("aria-label", `View fine for ${fine.title}, ${fine.memberName}`);
        button.addEventListener("click", () => operate(async current => {
            amountInput.value = "";
            receipt.hidden = true;
            finePanel.hidden = true;
            state.fine = null;
            await loadFine(current, fine.fineId, 1);
            byId("selected-heading").focus();
        }));

        action.append(button);
        row.append(
            book, member, element("td", money.format(Number(fine.fineAmount))),
            element("td", money.format(Number(fine.paidAmount))),
            element("td", money.format(Number(fine.balance))), statusCell, action
        );
        body.append(row);
    }

    if (!data.items.length) emptyRow(body, 7, "No fines match your search.");
    byId("page-number").textContent = `Page ${state.page} of ${state.pageCount}`;
    message(byId("list-message"), `${data.pagination.total} matching fine(s).`);
}

async function loadFine(run, fineId, page = 1) {
    const data = await api(run, `/api/manage/payments/${fineId}?paymentPage=${page}`);
    state.fine = data.fine;
    state.paymentPage = data.payments.pagination.page;
    state.paymentPageCount = data.payments.pagination.pageCount;

    const fine = data.fine;
    byId("selected-heading").textContent = fine.title;
    byId("fine-description").textContent =
        `${fine.memberName} | ${fine.memberNumber} | Copy: ${fine.barcode} | ${fine.overdueDays} overdue day(s)`;
    byId("fine-charged").textContent = money.format(Number(fine.fineAmount));
    byId("fine-paid").textContent = money.format(Number(fine.paidAmount));
    byId("fine-balance").textContent = money.format(Number(fine.balance));
    byId("fine-state").textContent = `Status: ${statusLabels[fine.status] || fine.status}`;

    const body = byId("payment-rows");
    body.replaceChildren();

    for (const payment of data.payments.items) {
        const row = document.createElement("tr");
        row.append(
            element("td", `#${payment.paymentId}`),
            element("td", money.format(Number(payment.amount))),
            element("td", payment.paymentDate),
            element("td", payment.recordedByName)
        );
        body.append(row);
    }

    if (!data.payments.items.length) {
        emptyRow(body, 4, "No payments have been recorded for this fine.");
    }

    byId("payment-page-number").textContent =
        `Page ${state.paymentPage} of ${state.paymentPageCount}`;
    finePanel.hidden = false;
}

async function refreshRecords(run, fineId, confirmed = false) {
    const results = await Promise.allSettled([
        loadList(run, state.page), loadFine(run, fineId, 1)
    ]);

    for (const item of results) {
        if (item.status !== "rejected") continue;
        if ([401, 403].includes(item.reason.status)) throw item.reason;

        if (confirmed) {
            message(pageMessage, "Payment recorded. Some records could not refresh; reload the page to view them.");
        }
    }
}

async function postPayment(run, payment) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
        if (!run.csrfToken) {
            const token = await api(run, "/api/auth/csrf-token");
            if (!/^[0-9a-f]{64}$/.test(token.csrfToken)) {
                throw new Error("Session verification failed.");
            }
            run.csrfToken = token.csrfToken;
        }

        // Check the account again after obtaining a token, including on retries.
        await checkStaff(run);

        try {
            return await api(run, `/api/manage/payments/${payment.fineId}`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "X-CSRF-Token": run.csrfToken
                },
                body: JSON.stringify({
                    amount: payment.amount, requestKey: payment.requestKey
                })
            });
        } catch (error) {
            if (error.code === "CSRF_INVALID" && attempt === 0) {
                run.csrfToken = "";
                continue;
            }
            throw error;
        }
    }
}

byId("payment-form").addEventListener("submit", event => {
    event.preventDefault();
    return operate(async run => {
        if (!state.fine) return;

        if (!state.pending) {
            const amount = normaliseAmount(amountInput.value);
            if (Number(amount) > Number(state.fine.balance)) {
                throw new Error(`The amount cannot exceed ${money.format(Number(state.fine.balance))}.`);
            }

            const payment = {
                fineId: state.fine.fineId, amount, requestKey: crypto.randomUUID()
            };

            // Save before sending so the same submission can be retried after refresh.
            try {
                sessionStorage.setItem(storageKey(run), JSON.stringify(payment));
            } catch (error) {
                throw new Error("The browser could not save this submission. Allow site storage and try again.");
            }

            state.pending = payment;
            setBusy(true);
        }

        const payment = { ...state.pending };
        message(pageMessage, "Recording payment...");

        let result;
        try {
            result = await postPayment(run, payment);
        } catch (error) {
            if (run === state.run && [400, 404, 409].includes(error.status)) {
                clearPending(run);
                await refreshRecords(run, payment.fineId);
            } else if (!error.status && error.name !== "AbortError") {
                error.message = "The payment could not be confirmed. Use Retry payment to check the same submission.";
            }
            throw error;
        }

        await checkStaff(run);
        const saved = result.receipt;

        message(receipt,
            `Receipt #${saved.paymentId}: ${money.format(Number(saved.amount))} recorded on ${saved.paymentDate}. `
            + `Balance after this payment: ${money.format(Number(saved.balanceAfterPayment))}. `
            + (result.replayed ? "This is the previously recorded payment." : ""));

        clearPending(run);
        amountInput.value = "";
        message(pageMessage, result.message, "success");
        receipt.focus();
        await refreshRecords(run, payment.fineId, true);
    });
});

filters.addEventListener("submit", event => {
    event.preventDefault();
    return operate(async run => {
        if (state.pending) return;
        state.filters = {
            search: byId("fine-search").value.trim(),
            status: byId("fine-status").value
        };
        await loadList(run, 1);
    });
});

byId("previous-page").addEventListener("click",
    () => operate(run => loadList(run, state.page - 1)));
byId("next-page").addEventListener("click",
    () => operate(run => loadList(run, state.page + 1)));
byId("refresh-fine").addEventListener("click",
    () => operate(run => loadFine(run, state.fine.fineId, state.paymentPage)));
byId("previous-payment-page").addEventListener("click",
    () => operate(run => loadFine(run, state.fine.fineId, state.paymentPage - 1)));
byId("next-payment-page").addEventListener("click",
    () => operate(run => loadFine(run, state.fine.fineId, state.paymentPage + 1)));

async function initialise() {
    state.run?.controller.abort();
    const run = {
        controller: new AbortController(), userId: null, csrfToken: ""
    };

    Object.assign(state, {
        run, pending: null, page: 1, pageCount: 1,
        paymentPage: 1, paymentPageCount: 1
    });

    clearView();
    byId("sign-in-prompt").hidden = true;
    message(pageMessage, "Checking staff access...");
    setBusy(true);

    try {
        await checkStaff(run);
        state.pending = restorePending(run);
        workspace.hidden = false;
        await loadList(run, 1);
        if (state.pending) await loadFine(run, state.pending.fineId, 1);
        pageMessage.hidden = true;
    } catch (error) {
        handleError(run, error);
    } finally {
        if (run === state.run) setBusy(false);
    }
}

window.addEventListener("pageshow", event => {
    if (event.persisted) initialise();
});
document.addEventListener("visibilitychange", () => {
    if (!document.hidden) initialise();
});

initialise();