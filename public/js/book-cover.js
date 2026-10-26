(() => {
    const validPath =
        /^\/covers\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.jpg$/;

    // Publisher-hosted covers for these editions in our sample catalogue.
    const publisherIsbns = new Set([
        "9781718502703", "9781718503403", "9781593279509", "9780262046305",
        "9781593279523", "9781718501065", "9780141036144", "9780241706985",
        "9780241341469", "9780141441146", "9780141199085", "9780143131847",
        "9780141199337", "9780141192642", "9781529962260", "9780141439600",
        "9780241736142", "9780241804681", "9780143107712", "9780241804735",
        "9780141385587", "9780141321004", "9781784872083", "9780141441030",
        "9780141186887", "9780099766810", "9780241733592", "9780143105954",
        "9780141034355", "9780099572954", "9780141441979", "9781529913934",
        "9781784703936", "9781784708283", "9780099511021", "9780241982976",
        "9780399588198", "9780553109535", "9781846041242", "9780141033570",
        "9781847946249", "9781784161859"
    ]);

    function create(book, { large = false } = {}) {
        const frame = document.createElement("div");

        frame.className = large
            ? "book-cover book-cover-large"
            : "book-cover";

        const placeholder = document.createElement("span");
        placeholder.className = "book-cover-placeholder";
        placeholder.textContent = "No cover available";
        frame.append(placeholder);

        const isbn = typeof book.isbn === "string"
            ? book.isbn.replace(/[\s-]/g, "").toUpperCase()
            : "";

        const validIsbn = /^(?:\d{13}|\d{9}[\dX])$/.test(isbn);
        const sources = [];

        if (
            typeof book.coverPath === "string"
            && validPath.test(book.coverPath)
        ) {
            sources.push({
                url: book.coverPath
            });
        }

        if (publisherIsbns.has(isbn)) {
            sources.push({
                url: `https://images.penguinrandomhouse.com/cover/${isbn}?height=${large ? 900 : 450}&alt=none`,
                credit: "Cover: Penguin Random House",
                link: "https://www.penguinrandomhouse.com/"
            });
        }

        if (validIsbn) {
            sources.push({
                url: `https://covers.openlibrary.org/b/isbn/${isbn}-${large ? "L" : "M"}.jpg?default=false`,
                credit: "Cover: Open Library",
                link: `https://openlibrary.org/isbn/${isbn}`
            });
        }

        if (sources.length === 0) {
            return frame;
        }

        const image = document.createElement("img");
        image.alt = `Cover of ${book.title}`;
        image.width = 600;
        image.height = 900;
        image.loading = large ? "eager" : "lazy";
        image.decoding = "async";
        image.referrerPolicy = "no-referrer";

        const credit = document.createElement("a");
        credit.className = "book-cover-credit";
        credit.hidden = true;

        let sourceIndex = 0;

        function loadSource() {
            const source = sources[sourceIndex];

            credit.hidden = true;
            credit.textContent = source.credit || "";
            credit.href = source.link || "";

            if (source.credit) {
                frame.classList.add("book-cover-external");
            }

            image.src = source.url;
        }

        image.addEventListener("load", () => {
            placeholder.hidden = true;
            credit.hidden = !sources[sourceIndex].credit;
        });

        image.addEventListener("error", () => {
            placeholder.hidden = false;
            credit.hidden = true;
            sourceIndex += 1;

            if (sourceIndex < sources.length) {
                loadSource();
            } else {
                image.remove();
                credit.remove();
            }
        });

        frame.append(image, credit);
        loadSource();

        return frame;
    }

    window.LibraCovers = { create };
})();