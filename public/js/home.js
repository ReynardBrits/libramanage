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

        if (!["admin", "librarian"].includes(data.user?.roleName)) {
            return;
        }

        const navigation = document.querySelector("header nav");

        if (!navigation) {
            return;
        }

        const links = [
            ["Manage books", "/manage-books.html"],
            ["Manage loans", "/manage-loans.html"],
            ["Manage payments", "/manage-payments.html"]
        ];

        for (const [label, href] of links) {
            if (navigation.querySelector(`a[href="${href}"]`)) {
                continue;
            }

            const link = document.createElement("a");
            link.href = href;
            link.textContent = label;

            navigation.append(link);
        }
    } catch (error) {
        console.error("Staff navigation could not be loaded:", error);
    }
}

addStaffNavigation();