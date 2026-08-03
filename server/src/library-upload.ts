import fs from "node:fs";
import path from "node:path";
import { safeOutputPath } from "./workflow.js";

/** Upload kinds accepted by POST /api/library/upload. */
export type LibraryKind = "lora" | "diffusion" | "checkpoint";

export const LIBRARY_KINDS = ["lora", "diffusion", "checkpoint"] as const;

/** Default allowlist — LoRAs and diffusion weights are .safetensors in this app. */
export const LIBRARY_ALLOWED_EXTENSIONS = new Set([".safetensors"]);

/** Hard cap per file (20 GiB). Multipart multer enforces the same limit. */
export const LIBRARY_MAX_FILE_BYTES = 20 * 1024 * 1024 * 1024;

/** Leave at least this much free after the upload lands. */
export const LIBRARY_MIN_FREE_AFTER_BYTES = 512 * 1024 * 1024;

export class LibraryUploadError extends Error {
  constructor(
    message: string,
    readonly status: number = 400,
    readonly code?: "duplicate" | "extension" | "path" | "kind" | "size" | "disk"
  ) {
    super(message);
    this.name = "LibraryUploadError";
  }
}

export function isLibraryKind(value: unknown): value is LibraryKind {
  return typeof value === "string" && (LIBRARY_KINDS as readonly string[]).includes(value);
}

/**
 * Resolve the destination directory for a kind under the Studio project root.
 * Does not create the directory.
 */
export function libraryDestinationDir(projectRoot: string, kind: LibraryKind): string {
  const root = path.resolve(projectRoot);
  switch (kind) {
    case "lora":
      return path.join(root, "lora");
    case "checkpoint":
      return path.join(root, "checkpoints");
    case "diffusion":
      return root;
    default: {
      const _exhaustive: never = kind;
      throw new LibraryUploadError(`Unsupported library kind: ${_exhaustive}`, 400, "kind");
    }
  }
}

/**
 * Sanitize an upload original name to a basename that cannot escape the target folder.
 * Rejects path separators, `..`, absolute paths, and empty results.
 */
export function sanitizeLibraryFilename(originalName: string): string {
  if (typeof originalName !== "string" || !originalName.trim()) {
    throw new LibraryUploadError("A filename is required.", 400, "path");
  }
  // Strip any directory components the client might send.
  const base = path.basename(originalName.replace(/\\/g, "/"));
  if (!base || base === "." || base === "..") {
    throw new LibraryUploadError("Invalid filename.", 400, "path");
  }
  if (base !== originalName.replace(/\\/g, "/").split("/").pop()) {
    // basename already applied; keep going
  }
  if (/[\\/]/.test(base) || base.includes("\0")) {
    throw new LibraryUploadError("Filename must not contain path separators.", 400, "path");
  }
  if (path.isAbsolute(base) || base.includes("..")) {
    throw new LibraryUploadError("Filename path traversal is not allowed.", 400, "path");
  }
  // Windows drive-letter style or reserved names
  if (/^[a-zA-Z]:/.test(base)) {
    throw new LibraryUploadError("Absolute paths are not allowed.", 400, "path");
  }
  return base;
}

export function assertLibraryExtension(filename: string): string {
  const extension = path.extname(filename).toLowerCase();
  if (!LIBRARY_ALLOWED_EXTENSIONS.has(extension)) {
    throw new LibraryUploadError(
      `Only ${[...LIBRARY_ALLOWED_EXTENSIONS].join(", ")} files can be uploaded to the library.`,
      400,
      "extension"
    );
  }
  return extension;
}

export function assertLibrarySize(size: number): void {
  if (!Number.isFinite(size) || size < 0) {
    throw new LibraryUploadError("Invalid file size.", 400, "size");
  }
  if (size > LIBRARY_MAX_FILE_BYTES) {
    throw new LibraryUploadError(
      `File exceeds the ${Math.round(LIBRARY_MAX_FILE_BYTES / (1024 * 1024 * 1024))} GB upload limit.`,
      400,
      "size"
    );
  }
  if (size === 0) {
    throw new LibraryUploadError("Empty files are not allowed.", 400, "size");
  }
}

/**
 * Validate name + kind and return a final path that is guaranteed to stay inside the destination folder.
 * Does not write anything. Throws LibraryUploadError on validation failure or if the file already exists.
 */
export function resolveLibraryTarget(
  projectRoot: string,
  kind: LibraryKind,
  originalName: string,
  options: { allowExisting?: boolean } = {}
): { filename: string; destinationDir: string; finalPath: string } {
  if (!isLibraryKind(kind)) {
    throw new LibraryUploadError('kind must be "lora", "diffusion", or "checkpoint".', 400, "kind");
  }
  const filename = sanitizeLibraryFilename(originalName);
  assertLibraryExtension(filename);
  const destinationDir = libraryDestinationDir(projectRoot, kind);
  let finalPath: string;
  try {
    finalPath = safeOutputPath(destinationDir, filename);
  } catch {
    throw new LibraryUploadError("Resolved path leaves the target library folder.", 400, "path");
  }
  if (!options.allowExisting && fs.existsSync(finalPath)) {
    throw new LibraryUploadError(
      `A file named ${filename} already exists in the ${kind} library. Choose a different name — existing models are never overwritten.`,
      409,
      "duplicate"
    );
  }
  return { filename, destinationDir, finalPath };
}

export function assertLibraryDiskSpace(freeBytes: number, fileSize: number): void {
  if (!Number.isFinite(freeBytes) || freeBytes <= 0) {
    // Unknown free space: do not hard-fail; size limit still applies.
    return;
  }
  if (freeBytes < fileSize + LIBRARY_MIN_FREE_AFTER_BYTES) {
    throw new LibraryUploadError(
      "Not enough free disk space to store this model safely.",
      507,
      "disk"
    );
  }
}

/**
 * Move a staged temp file into the final library path without overwriting.
 * Uses COPYFILE_EXCL then unlinks the temp so a partial never appears under the real name,
 * and an existing file can never be replaced.
 */
export function installLibraryFile(tempPath: string, finalPath: string): void {
  if (!fs.existsSync(tempPath)) {
    throw new LibraryUploadError("Upload staging file is missing.", 400);
  }
  if (fs.existsSync(finalPath)) {
    throw new LibraryUploadError(
      `A file named ${path.basename(finalPath)} already exists. Existing models are never overwritten.`,
      409,
      "duplicate"
    );
  }
  fs.mkdirSync(path.dirname(finalPath), { recursive: true });
  try {
    fs.copyFileSync(tempPath, finalPath, fs.constants.COPYFILE_EXCL);
  } catch (error: any) {
    if (error?.code === "EEXIST") {
      throw new LibraryUploadError(
        `A file named ${path.basename(finalPath)} already exists. Existing models are never overwritten.`,
        409,
        "duplicate"
      );
    }
    throw error;
  }
  try {
    fs.unlinkSync(tempPath);
  } catch {
    // Final file is already in place; orphaned staging files are cleaned separately.
  }
}

/** Full pre-install validation used by the route and unit tests. */
export function validateLibraryUpload(input: {
  projectRoot: string;
  kind: unknown;
  originalName: string;
  size: number;
  freeBytes?: number;
}): { kind: LibraryKind; filename: string; destinationDir: string; finalPath: string } {
  if (!isLibraryKind(input.kind)) {
    throw new LibraryUploadError('kind must be "lora", "diffusion", or "checkpoint".', 400, "kind");
  }
  assertLibrarySize(input.size);
  if (input.freeBytes !== undefined) assertLibraryDiskSpace(input.freeBytes, input.size);
  const target = resolveLibraryTarget(input.projectRoot, input.kind, input.originalName);
  return { kind: input.kind, ...target };
}
