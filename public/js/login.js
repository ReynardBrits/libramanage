const loginForm = document.getElementById("login-form");
const loginButton = document.getElementById("login-button");
const logoutButton = document.getElementById("logout-button");

const accountHeading = document.getElementById("account-heading");
const accountIntro = document.getElementById("account-intro");
const accountPanel = document.getElementById("account-panel");
const accountDetails = document.getElementById("account-details");
const accountMessage = document.getElementById("account-message");

let csrfToken = "";
let busy = false;

function showMessage(message, state) {
    accountMessage.textContent = message;
    accountMessage.dataset.state = state;
    accountMessage.hidden = false;
}

function setBusy(value) {
    busy = value;
    loginButton.disabled = value;
    logoutButton.disabled = value;

    loginForm.setAttribute("aria-busy", String(value));
}

function showLogin() {
    document.title = "Sign in | LibraManage";
    accountHeading.textContent = "Sign in";
    accountIntro.textContent = "Enter your email address and password.";

    accountDetails.replaceChildren();
    accountPanel.hidden = true;

    loginForm.reset();
    loginForm.hidden = false;
    accountMessage.hidden = true;
}

function showAccount(user) {
    const roleNames = {
        member: "Member",
        librarian: "Librarian",
        admin: "Administrator"
    };

    document.title = "My account | LibraManage";
    accountHeading.textContent = "My account";
    accountIntro.textContent = `Welcome, ${user.firstName}.`;

    const borrowingStatus = user.borrowingStatus
        ? user.borrowingStatus.charAt(0).toUpperCase() +
            user.borrowingStatus.slice(1)
        : "Not applicable";

    const details = [
        ["Name", `${user.firstName} ${user.lastName}`],
        ["Email", user.email],
        ["Account type", roleNames[user.roleName] || user.roleName],
        ["Membership number", user.memberNumber || "Not applicable"],
        ["Borrowing status", borrowingStatus]
    ];

    accountDetails.replaceChildren();

    for (const [label, value] of details) {
        const term = document.createElement("dt");
        const description = document.createElement("dd");

        term.textContent = label;
        description.textContent = value;

        accountDetails.append(term, description);
    }

    loginForm.reset();
    loginForm.hidden = true;

    accountPanel.hidden = false;
    accountMessage.hidden = true;
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
        throw new Error("Could not prepare the sign-in form.");
    }

    csrfToken = data.csrfToken;
}

// Refresh an expired token once before retrying the request.
async function postAuth(path, values) {
    if (!csrfToken) {
        await loadCsrfToken();
    }

    const sendRequest = () => fetch(path, {
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

    if (response.status === 403) {
        await loadCsrfToken();
        response = await sendRequest();
    }

    return response;
}

async function loadPage() {
    if (busy) {
        return;
    }

    setBusy(true);

    loginForm.hidden = true;
    accountPanel.hidden = true;
    accountMessage.hidden = true;

    accountIntro.textContent = "Checking your sign-in status...";

    try {
        await loadCsrfToken();

        const response = await fetch("/api/auth/me", {
            credentials: "same-origin",
            cache: "no-store"
        });

        if (response.status === 401) {
            showLogin();
            return;
        }

        const data = await response.json();

        if (!response.ok || !data.user) {
            throw new Error("Could not load account details.");
        }

        showAccount(data.user);
    } catch (error) {
        console.error("Account check failed:", error.message);

        accountIntro.textContent = "Access your library account.";

        showMessage(
            "We could not load your account. Please refresh the page to try again.",
            "error"
        );
    } finally {
        setBusy(false);
    }
}

loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    if (busy) {
        return;
    }

    setBusy(true);
    loginButton.textContent = "Signing in...";

    showMessage("Signing in...", "loading");

    try {
        const values = Object.fromEntries(
            new FormData(loginForm).entries()
        );

        const response = await postAuth("/api/auth/login", values);
        const data = await response.json();

        if (!response.ok) {
            showMessage(
                data.message || "We could not sign you in.",
                "error"
            );

            accountMessage.focus();
            return;
        }

        if (
            !data.user ||
            typeof data.csrfToken !== "string"
        ) {
            throw new Error("Unexpected sign-in response.");
        }

        csrfToken = data.csrfToken;

        showAccount(data.user);
        showMessage("You are signed in.", "success");
    } catch (error) {
        console.error("Sign-in failed:", error.message);

        showMessage(
            "We could not sign you in. Please try again.",
            "error"
        );
    } finally {
        setBusy(false);
        loginButton.textContent = "Sign in";
    }
});

logoutButton.addEventListener("click", async () => {
    if (busy) {
        return;
    }

    setBusy(true);
    logoutButton.textContent = "Signing out...";

    try {
        const response = await postAuth("/api/auth/logout", {});
        const data = await response.json();

        if (!response.ok) {
            showMessage(
                data.message || "We could not sign you out.",
                "error"
            );

            return;
        }

        csrfToken = "";
        showLogin();

        showMessage("You have been signed out.", "success");

        loginForm.elements.namedItem("email").focus();
    } catch (error) {
        console.error("Sign-out failed:", error.message);

        showMessage(
            "We could not sign you out. Please try again.",
            "error"
        );
    } finally {
        setBusy(false);
        logoutButton.textContent = "Sign out";
    }
});

// Recheck the account when returning through browser history.
window.addEventListener("pageshow", (event) => {
    if (event.persisted) {
        loadPage();
    }
});

loadPage();