/**
 * Base class for scan-level errors. Always thrown, never returned.
 *
 * The class is the canonical error surface for `scanRepository`. It
 * subclasses `Error` so `instanceof Error` keeps working in catch-all
 * handlers, but its real discriminator is the `.code` field.
 */
export class RepositoryScanError extends Error {
    code;
    rootPath;
    constructor(code, rootPath, message) {
        super(message);
        this.name = "RepositoryScanError";
        this.code = code;
        this.rootPath = rootPath;
    }
}
