(() => {
    const { byId, element, message, requestJson } = window.LibraUI;

    const workspace = byId("reservation-workspace");
    const notice = byId("reservation-message");
    const signIn = byId("reservation-sign-in");
    const filters = byId("reservation-filters");
    const search = byId("reservation-search");
    const status = byId("reservation-status");
    const results = byId("reservation-results");
    const previous = byId("reservation-previous");
    const next = byId("reservation-next");

    let userId = null;
    let page = 1;
    let pageCount = 1;
    let busy = false;

    function clearPrivate() {
        workspace.hidden = true;
        results.replaceChildren();
        search.value = "";
        byId("reservation-page").textContent = "";
    }

    function setBusy(value) {
        busy = value;
        workspace.setAttribute("aria-busy", String(value));

        for (const control of workspace.querySelectorAll("button, input, select")) {
            control.disabled = value;
        }

        previous.disabled = value || page <= 1;
        next.disabled = value || page >= pageCount;
    }

    async function request(path, options) {
        const { response, data } = await requestJson(path, options);

        if (!response.ok) {
            if ([401, 403].includes(response.status)) {
                clearPrivate();
                signIn.hidden = response.status !== 401;
            }

            throw new Error(
                data.message || "The reservation request failed."
            );
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
                "Only administrators and librarians can manage reservations."
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

    function actionButton(item, action, label) {
        const button = element("button", label, "button-secondary");
        button.type = "button";

        button.setAttribute(
            "aria-label",
            `${label}: ${item.title}, ${item.memberNumber}`
        );

        button.addEventListener("click", () => perform(
            `/api/manage/reservations/${encodeURIComponent(item.reservationId)}/${action}`
        ));

        return button;
    }

    function render(items) {
        results.replaceChildren();

        if (!items.length) {
            results.append(
                element("p", "No reservations match these filters.")
            );
            return;
        }

        for (const item of items) {
            const card = document.createElement("article");
            card.className = "book-card";

            card.append(
                element("h3", item.title),
                element("p", `${item.memberName} · ${item.memberNumber}`),
                element("p", `Collection branch: ${item.branchName}`),
                element("p", `Status: ${item.status}`, "book-availability"),
                element("p", `Reserved: ${item.reservationDate}`)
            );

            if (item.barcode) {
                card.append(element("p", `Copy: ${item.barcode}`));
            }

            if (item.status === "queued") {
                card.append(
                    element("p", `Queue position: ${item.queuePosition}`)
                );
            }

            if (item.status === "ready") {
                card.append(element(
                    "p",
                    `Collect before: ${item.heldUntil} (South African time)`
                ));
            }

            const actions = document.createElement("div");
            actions.className = "reservation-actions";

            if (item.status === "queued" && item.queuePosition === 1) {
                actions.append(
                    actionButton(item, "prepare", "Prepare copy")
                );
            }

            if (item.status === "ready") {
                actions.append(
                    actionButton(item, "collect", "Collect and issue loan")
                );
            }

            if (["queued", "ready"].includes(item.status)) {
                actions.append(
                    actionButton(item, "cancel", "Cancel reservation")
                );
            }

            if (actions.childElementCount) card.append(actions);

            results.append(card);
        }
    }

    async function loadList(requestedPage) {
        const query = new URLSearchParams({
            search: search.value.trim(),
            status: status.value,
            page: String(requestedPage)
        });

        const data = await request(`/api/manage/reservations?${query}`);

        await checkStaff();

        if (!Array.isArray(data.items) || !data.pagination) {
            throw new Error("Unexpected reservation response.");
        }

        page = data.pagination.page;
        pageCount = data.pagination.pageCount;

        render(data.items);

        byId("reservation-page").textContent =
            `Page ${page} of ${pageCount} · ${data.pagination.total} reservations`;
    }

    async function refresh(requestedPage = 1) {
        if (busy) return;

        setBusy(true);
        results.replaceChildren();
        message(notice, "Loading reservations...", "loading");

        try {
            await checkStaff();
            await loadList(requestedPage);

            workspace.hidden = false;
            signIn.hidden = true;
            notice.hidden = true;
        } catch (error) {
            message(notice, error.message, "error");
        } finally {
            setBusy(false);
        }
    }

    async function perform(path) {
        if (busy) return;

        setBusy(true);
        message(notice, "Saving reservation action...", "loading");

        try {
            const token = await request("/api/auth/csrf-token");
            await checkStaff();

            const result = await request(path, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "X-CSRF-Token": token.csrfToken
                },
                body: JSON.stringify({})
            });

            const text = result.message || (
                `Released ${result.expiredCount} expired holds across ${result.booksProcessed} books.`
                + (
                    result.booksProcessed === 20
                        ? " Run again to check for more."
                        : ""
                )
            );

            message(notice, text, "success");
            results.replaceChildren();

            try {
                await loadList(page);
            } catch (error) {
                message(
                    notice,
                    `The action succeeded, but the list could not refresh. ${error.message}`,
                    "error"
                );
            }
        } catch (error) {
            message(
                notice,
                `${error.message} Refresh the list before trying again.`,
                "error"
            );
        } finally {
            setBusy(false);
        }
    }

    filters.addEventListener("submit", event => {
        event.preventDefault();
        refresh(1);
    });

    previous.addEventListener("click", () => refresh(page - 1));
    next.addEventListener("click", () => refresh(page + 1));

    byId("reservation-refresh").addEventListener(
        "click",
        () => refresh(page)
    );

    byId("reservation-expire").addEventListener(
        "click",
        () => perform("/api/manage/reservations/expire-holds")
    );

    window.addEventListener("pagehide", clearPrivate);

    window.addEventListener("pageshow", event => {
        if (event.persisted) location.reload();
    });

    refresh();
})();