const registrationForm =
    document.getElementById("registration-form");

const registerButton =
    document.getElementById("register-button");

const registrationMessage =
    document.getElementById("registration-message");

const fieldNames = [
    "firstName",
    "lastName",
    "email",
    "password",
    "confirmPassword"
];

let submitting = false;

function showMessage(message, state) {
    registrationMessage.textContent = message;
    registrationMessage.dataset.state = state;
    registrationMessage.hidden = false;
}

function clearFieldError(name) {
    const input = registrationForm.elements.namedItem(name);
    const error = document.getElementById(`${name}-error`);

    if (input instanceof HTMLInputElement) {
        input.removeAttribute("aria-invalid");
    }

    if (error) {
        error.textContent = "";
        error.hidden = true;
    }
}

function showFieldError(name, message) {
    if (!fieldNames.includes(name)) {
        return;
    }

    const input = registrationForm.elements.namedItem(name);
    const error = document.getElementById(`${name}-error`);

    input.setAttribute("aria-invalid", "true");
    error.textContent = message;
    error.hidden = false;
}

function focusOnError() {
    const invalidInput =
        registrationForm.querySelector('[aria-invalid="true"]');

    if (invalidInput) {
        invalidInput.focus();
    } else {
        registrationMessage.focus();
    }
}

// Remove a field's old error when it is edited.
registrationForm.addEventListener("input", (event) => {
    if (event.target instanceof HTMLInputElement) {
        clearFieldError(event.target.name);
    }
});

registrationForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    if (submitting) {
        return;
    }

    for (const name of fieldNames) {
        clearFieldError(name);
    }

    registrationMessage.hidden = true;

    const values = Object.fromEntries(
        new FormData(registrationForm).entries()
    );

    if (values.password !== values.confirmPassword) {
        showFieldError(
            "confirmPassword",
            "Your passwords must match."
        );

        showMessage(
            "Please check the highlighted field.",
            "error"
        );

        focusOnError();
        return;
    }

    submitting = true;
    registerButton.disabled = true;
    registerButton.textContent = "Creating account...";
    registrationForm.setAttribute("aria-busy", "true");

    showMessage("Creating your account...", "loading");

    try {
        const response = await fetch("/api/auth/register", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Accept: "application/json"
            },
            body: JSON.stringify(values)
        });

        const data = await response.json();

        if (!response.ok) {
            showMessage(
                data.message ||
                    "We could not create your account. Please try again.",
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

        registrationForm.reset();
        registrationForm.hidden = true;

        showMessage(
            `Your account has been created. Your membership number is ${data.memberNumber}.`,
            "success"
        );

        registrationMessage.focus();
    } catch (error) {
        console.error("Registration request failed:", error.message);

        showMessage(
            "We could not create your account. Please try again.",
            "error"
        );

        registrationMessage.focus();
    } finally {
        submitting = false;
        registerButton.disabled = false;
        registerButton.textContent = "Create account";
        registrationForm.removeAttribute("aria-busy");
    }
});