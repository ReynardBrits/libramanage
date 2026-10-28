(() => {
    const { byId, message } = window.LibraUI;
    const form = byId("registration-form");
    const button = byId("register-button");
    const statusMessage = byId("registration-message");
    const fieldNames = [
        "firstName", "lastName", "email", "password", "confirmPassword"
    ];

    let submitting = false;

    function showMessage(text, state) {
        message(statusMessage, text, state);
    }

    function clearFieldError(name) {
        const input = form.elements.namedItem(name);
        const error = byId(`${name}-error`);

        if (input instanceof HTMLInputElement) {
            input.removeAttribute("aria-invalid");
        }

        if (error) {
            error.textContent = "";
            error.hidden = true;
        }
    }

    function showFieldError(name, text) {
        if (!fieldNames.includes(name)) return;

        form.elements.namedItem(name).setAttribute("aria-invalid", "true");

        const error = byId(`${name}-error`);
        error.textContent = text;
        error.hidden = false;
    }

    function focusOnError() {
        const target = form.querySelector('[aria-invalid="true"]')
            || statusMessage;
        target.focus();
    }

    function setSubmitting(value) {
        submitting = value;
        button.disabled = value;
        button.textContent = value ? "Creating account..." : "Create account";

        if (value) {
            form.setAttribute("aria-busy", "true");
        } else {
            form.removeAttribute("aria-busy");
        }
    }

    async function loadCsrfToken() {
        const response = await fetch("/api/auth/csrf-token", {
            credentials: "same-origin",
            cache: "no-store",
            headers: {
                Accept: "application/json"
            }
        });

        const data = await response.json();

        if (
            !response.ok
            || typeof data.csrfToken !== "string"
            || !/^[0-9a-f]{64}$/.test(data.csrfToken)
        ) {
            throw new Error("Could not obtain a valid CSRF token.");
        }

        return data.csrfToken;
    }

    form.addEventListener("input", event => {
        if (event.target instanceof HTMLInputElement) {
            clearFieldError(event.target.name);
        }
    });

    form.addEventListener("submit", async event => {
        event.preventDefault();
        if (submitting) return;

        fieldNames.forEach(clearFieldError);
        statusMessage.hidden = true;

        const values = Object.fromEntries(new FormData(form).entries());

        if (values.password !== values.confirmPassword) {
            showFieldError("confirmPassword", "Your passwords must match.");
            showMessage("Please check the highlighted field.", "error");
            focusOnError();
            return;
        }

        setSubmitting(true);
        showMessage("Creating your account...", "loading");

        try {
            const csrfToken = await loadCsrfToken();

            const response = await fetch("/api/auth/register", {
                method: "POST",
                credentials: "same-origin",
                cache: "no-store",
                headers: {
                    "Content-Type": "application/json",
                    "X-CSRF-Token": csrfToken,
                    Accept: "application/json"
                },
                body: JSON.stringify(values)
            });

            const data = await response.json();

            if (!response.ok) {
                showMessage(
                    data.message
                    || "We could not create your account. Please try again.",
                    "error"
                );

                if (Array.isArray(data.errors)) {
                    for (const error of data.errors) {
                        showFieldError(error.field, error.message);
                    }
                }

                focusOnError();
                return;
            }

            if (typeof data.memberNumber !== "string") {
                throw new Error("Unexpected registration response.");
            }

            form.reset();
            form.hidden = true;

            showMessage(
                `Your account has been created. Your membership number is ${data.memberNumber}.`,
                "success"
            );

            statusMessage.focus();
        } catch (error) {
            console.error("Registration request failed:", error.message);
            showMessage(
                "We could not create your account. Please try again.",
                "error"
            );
            statusMessage.focus();
        } finally {
            setSubmitting(false);
        }
    });
})();