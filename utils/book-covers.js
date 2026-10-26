const path = require("node:path");
const fs = require("node:fs/promises");
const { randomUUID } = require("node:crypto");
const sharp = require("sharp");

const MAX_COVER_BYTES = 8 * 1024 * 1024;

const COVER_DIRECTORY = path.resolve(
    process.env.BOOK_COVER_DIR
        || path.join(__dirname, "..", "storage", "covers")
);

const COVER_URL_PREFIX = "/covers/";

const COVER_PATH =
    /^\/covers\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.jpg$/;

function invalidCover(message, status = 400) {
    return Object.assign(new Error(message), { status });
}

async function compressCover(buffer) {
    if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
        throw invalidCover("Choose a cover image.");
    }

    if (buffer.length > MAX_COVER_BYTES) {
        throw invalidCover("Cover images must not exceed 8 MB.", 413);
    }

    try {
        const image = sharp(buffer, {
            limitInputPixels: 20000000,
            failOn: "warning"
        });

        const metadata = await image.metadata();

        if (
            !["jpeg", "png", "webp"].includes(metadata.format)
            || (metadata.pages || 1) > 1
        ) {
            throw invalidCover(
                "Use a still JPEG, PNG or WebP cover image."
            );
        }

        return await image
            .rotate()
            .resize({
                width: 600,
                height: 900,
                fit: "inside",
                withoutEnlargement: true
            })
            .flatten({ background: "#ffffff" })
            .jpeg({ quality: 75, mozjpeg: true })
            .toBuffer();
    } catch (error) {
        if (error.status) throw error;

        throw invalidCover(
            "The cover could not be read. Use a valid image under 20 megapixels."
        );
    }
}

async function saveCover(buffer) {
    const compressed = await compressCover(buffer);

    await fs.mkdir(COVER_DIRECTORY, { recursive: true });

    const filename = `${randomUUID()}.jpg`;
    const destination = path.join(COVER_DIRECTORY, filename);
    const handle = await fs.open(destination, "wx");

    try {
        await handle.writeFile(compressed);
    } catch (error) {
        await handle.close();
        await fs.unlink(destination).catch(() => {});
        throw error;
    }

    await handle.close();

    return `${COVER_URL_PREFIX}${filename}`;
}

async function deleteCover(coverPath) {
    if (
        typeof coverPath !== "string"
        || !COVER_PATH.test(coverPath)
    ) {
        return;
    }

    try {
        await fs.unlink(
            path.join(COVER_DIRECTORY, path.basename(coverPath))
        );
    } catch (error) {
        if (error.code !== "ENOENT") throw error;
    }
}

module.exports = {
    MAX_COVER_BYTES,
    COVER_DIRECTORY,
    COVER_URL_PREFIX,
    compressCover,
    saveCover,
    deleteCover
};