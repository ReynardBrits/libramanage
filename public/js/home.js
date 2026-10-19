async function addStaffNavigation() {
    try {
        const response = await fetch("/api/auth/me", {
            credentials: "same-origin",
            cache: "no-store"
        });

        if (!response.ok) {
            return;
        }

        const data = await response.json();

        if (
            !["admin", "librarian"].includes(data.user?.roleName)
        ) {
            return;
        }

        const navigation = document.querySelector(".site-nav");
        const link = document.createElement("a");

        link.href = "/manage-books.html";
        link.textContent = "Manage books";

        navigation.append(link);
    } catch (error) {
        console.error(
            "Could not load account navigation:",
            error.message
        );
    }
}

addStaffNavigation();