(() => {
    const { byId, element, message, requestJson } = window.LibraUI;

    const workspace = byId("reservation-workspace");
    const notice = byId("reservation-message");
    const signIn = byId("reservation-sign-in");
    const form = byId("reservation-form");
    const branch = byId("reservation-branch");
    const filter = byId("reservation-status");
    const results = byId("reservation-results");
    const previous = byId("reservation-previous");
    const next = byId("reservation-next");

    const bookId = new URLSearchParams(location.search).get("bookId");
    const validBook = /^[1-9]\d{0,9}$/.test(bookId || "")
        && Number(bookId) <= 4294967295;

    let userId = null;
    let page = 1;
    let pageCount = 1;
    let busy = false;

    function setBusy(value) {
        busy = value;
        workspace.setAttribute("aria-busy", String(value));

        for (const control of workspace.querySelectorAll("button, select")) {
            control.disabled = value;
        }

        previous.disabled = value || page <= 1;
        next.disabled = value || page >= pageCount;
    }

    function clearPrivate() {
        workspace.hidden = true;
        results.replaceChildren();
        branch.replaceChildren();
        form.hidden = true;

        byId("reservation-book-title").textContent = "";
        byId("reservation-policy").textContent = "";
        byId("reservation-page").textContent = "";
    }

    async function read(path, options) {
        const { response, data } = await requestJson(path, options);

        if (!response.ok) {
            if (response.status === 401 || response.status === 403) {
                clearPrivate();
                signIn.hidden = response.status !== 401;
            }

            throw new Error(
                data.message || "The reservation request failed."
            );
        }

        return data;
    }

    async function checkIdentity() {
        const { user } = await read("/api/auth/me");

        if (!Number.isInteger(user?.userId)) {
            throw new Error("Unexpected account response.");
        }

        if (userId !== null && userId !== user.userId) {
            clearPrivate();
            throw new Error(
                "The signed-in account changed. Refresh this page."
            );
        }

        userId = user.userId;
    }

    function render(items) {
        results.replaceChildren();

        if (!items.length) {
            results.append(
                element("p", "No reservations match this filter.")
            );
            return;
        }

        for (const item of items) {
            const card = document.createElement("article");
            card.className = "book-card";

            card.append(
                element("h3", item.title),
                element("p", `Collection branch: ${item.branchName}`),
                element("p", `Status: ${item.status}`),
                element("p", `Reserved: ${item.reservationDate}`)
            );

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

            if (["queued", "ready"].includes(item.status)) {
                const cancel = element(
                    "button",
                    "Cancel reservation",
                    "button-secondary"
                );

                cancel.type = "button";
                cancel.setAttribute(
                    "aria-label",
                    `Cancel reservation for ${item.title}`
                );

                cancel.addEventListener("click", () => change(
                    `/api/my-reservations/${encodeURIComponent(item.reservationId)}/cancel`,
                    {}
                ));

                card.append(cancel);
            }

            results.append(card);
        }
    }

    async function loadList(requestedPage) {
        const query = new URLSearchParams({
            status: filter.value,
            page: String(requestedPage)
        });

        const data = await read(`/api/my-reservations?${query}`);

        if (data.userId !== userId) {
            clearPrivate();
            throw new Error(
                "The signed-in account changed. Refresh this page."
            );
        }

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

        try {
            await checkIdentity();
            await loadList(requestedPage);

            workspace.hidden = false;
            signIn.hidden = true;
        } catch (error) {
            message(notice, error.message, "error");
        } finally {
            setBusy(false);
        }
    }

    async function change(path, values) {
        if (busy) return;

        setBusy(true);
        message(notice, "Saving your reservation...", "loading");

        try {
            const token = await read("/api/auth/csrf-token");
            await checkIdentity();

            const result = await read(path, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "X-CSRF-Token": token.csrfToken
                },
                body: JSON.stringify(values)
            });

            message(
                notice,
                result.message || "Reservation updated.",
                "success"
            );

            try {
                await loadList(1);
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
                `${error.message} Refresh your reservations before trying again.`,
                "error"
            );
        } finally {
            setBusy(false);
        }
    }

    async function initialise() {
        setBusy(true);

        try {
            await checkIdentity();
            await loadList(1);

            workspace.hidden = false;

            if (validBook) {
                const options = await read(
                    `/api/my-reservations/options/${bookId}`
                );

                if (
                    !options.book
                    || !Array.isArray(options.branches)
                    || !options.policies
                ) {
                    throw new Error("Unexpected reservation options.");
                }

                byId("reservation-book-title").textContent =
                    options.book.title;

                byId("reservation-policy").textContent =
                    `Up to ${options.policies.maxActiveReservations} active reservations. Prepared copies are held for ${options.policies.holdHours} hours.`;

                branch.replaceChildren(
                    new Option("Choose a collection branch", "")
                );

                for (const item of options.branches) {
                    branch.add(new Option(item.branchName, item.branchId));
                }

                form.hidden = options.branches.length === 0;

                if (!options.branches.length) {
                    message(
                        notice,
                        "This book has no circulating copies at an active branch."
                    );
                }
            }
        } catch (error) {
            message(notice, error.message, "error");
        } finally {
            setBusy(false);
        }
    }

    form.addEventListener("submit", event => {
        event.preventDefault();

        if (validBook && branch.value) {
            change("/api/my-reservations", {
                bookId,
                branchId: branch.value
            });
        }
    });

    filter.addEventListener("change", () => refresh(1));
    previous.addEventListener("click", () => refresh(page - 1));
    next.addEventListener("click", () => refresh(page + 1));

    byId("reservation-refresh").addEventListener(
        "click",
        () => refresh(page)
    );

    window.addEventListener("pagehide", clearPrivate);

    window.addEventListener("pageshow", event => {
        if (event.persisted) location.reload();
    });

    initialise();
})();