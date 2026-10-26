(() => {
    const validPath =
        /^\/covers\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.jpg$/;

    function create(book, { large = false } = {}) {
        const frame = document.createElement("div");
        frame.className = large
            ? "book-cover book-cover-large"
            : "book-cover";

        const placeholder = document.createElement("span");
        placeholder.className = "book-cover-placeholder";
        placeholder.textContent = "No cover available";

        if (
            typeof book.coverPath === "string"
            && validPath.test(book.coverPath)
        ) {
            const image = document.createElement("img");

            image.alt = `Cover of ${book.title}`;
            image.width = 600;
            image.height = 900;
            image.loading = large ? "eager" : "lazy";
            image.decoding = "async";

            image.addEventListener("load", () => {
                placeholder.hidden = true;
            }, { once: true });

            image.addEventListener("error", () => {
                image.remove();
                placeholder.hidden = false;
            }, { once: true });

            image.src = book.coverPath;
            frame.append(image);
        }

        frame.append(placeholder);

        return frame;
    }

    window.LibraCovers = { create };
})();