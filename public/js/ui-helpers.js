(() => {
    const byId = id => document.getElementById(id);
    const money = new Intl.NumberFormat("en-ZA", {
        style: "currency", currency: "ZAR"
    });

    function message(target, text, status = "info") {
        target.textContent = text;
        target.dataset.state = status;
        target.hidden = false;
    }

    function element(tag, text, className) {
        const node = document.createElement(tag);
        node.textContent = text;
        if (className) node.className = className;
        return node;
    }

    async function requestJson(path, options = {}) {
        const response = await fetch(path, {
            credentials: "same-origin", cache: "no-store", ...options
        });
        return { response, data: await response.json() };
    }

    function createApi({ csrfError = "Session verification failed.", retryAny403 = false } = {}) {
        const api = {
            csrfToken: "",
            get: requestJson,

            async loadCsrfToken() {
                const { response, data } = await requestJson("/api/auth/csrf-token");
                if (!response.ok || typeof data.csrfToken !== "string") {
                    throw new Error(csrfError);
                }
                api.csrfToken = data.csrfToken;
            },

            async post(path, values) {
                if (!api.csrfToken) await api.loadCsrfToken();

                for (let attempt = 0; attempt < 2; attempt += 1) {
                    const result = await requestJson(path, {
                        method: "POST",
                        headers: {
                            "Content-Type": "application/json",
                            "X-CSRF-Token": api.csrfToken
                        },
                        body: JSON.stringify(values)
                    });

                    const csrfFailed = result.response.status === 403
                        && (retryAny403 || result.data.code === "CSRF_INVALID");

                    if (!csrfFailed || attempt === 1) return result;
                    await api.loadCsrfToken();
                }
            }
        };

        return api;
    }

    window.LibraUI = { byId, money, message, element, requestJson, createApi };
})();