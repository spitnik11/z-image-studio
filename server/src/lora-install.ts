/**
 * Modular local LoRA install for Z-Image Studio.
 *
 * One path for agents, scripts, and (optionally) API callers:
 *   source file → hash → copy (never overwrite) → metadata classify → registry upsert → verify
 *
 * Adding a Krea LoRA from disk:
 *   installLoraFromPath(projectRoot, "C:\\path\\to\\file.safetensors", { expectArchitecture: "krea2" })
 *
 * Does not download from the network. Does not delete or rename existing library files.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  installLibraryFile,
  resolveLibraryTarget,
  sanitizeLibraryFilename,
  assertLibraryExtension
} from "./library-upload.js";
import {
  inferLoraArchitecture,
  LoraRegistry,
  readSafetensorsMetadata,
  type LoraCategory,
  type LoraRecord
} from "./lora-registry.js";

export type InstallLoraOptions = {
  /** Prefer this architecture when metadata is empty but the user knows the base (e.g. "krea2"). */
  expectArchitecture?: LoraRecord["architecture"];
  displayName?: string;
  category?: LoraCategory;
  tags?: string[];
  activationWords?: string[];
  recommendedStrength?: number;
  usageGuide?: string;
  notes?: string;
  /** When true (default), mark verified if architecture resolves to a known family. */
  markVerified?: boolean;
  /** Force destination basename (still sanitized). Default: source basename. */
  destFilename?: string;
};

export type InstallLoraResult = {
  filename: string;
  finalPath: string;
  sha256: string;
  sizeBytes: number;
  architecture: LoraRecord["architecture"];
  metadataKeys: string[];
  record: LoraRecord;
  alreadyExisted: boolean;
};

export function hashFileSha256(filePath: string): string {
  const hash = crypto.createHash("sha256");
  const fd = fs.openSync(filePath, "r");
  try {
    const buf = Buffer.alloc(1024 * 1024);
    let read: number;
    while ((read = fs.readSync(fd, buf, 0, buf.length, null)) > 0) {
      hash.update(buf.subarray(0, read));
    }
  } finally {
    fs.closeSync(fd);
  }
  return hash.digest("hex").toUpperCase();
}

function metaString(metadata: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = metadata[key];
    if (value !== undefined && value !== null && String(value).trim()) return String(value).trim();
  }
  return undefined;
}

function metaNumber(metadata: Record<string, unknown>, keys: string[]): number | undefined {
  const raw = metaString(metadata, keys);
  if (raw === undefined) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Build a registry record from a safetensors path. Does not write the registry.
 */
export function buildLoraRecordFromFile(
  filePath: string,
  options: InstallLoraOptions = {}
): { record: LoraRecord; metadata: Record<string, unknown>; sha256: string; sizeBytes: number } {
  if (!fs.existsSync(filePath)) {
    throw new Error(`LoRA file not found: ${filePath}`);
  }
  const filename = options.destFilename
    ? sanitizeLibraryFilename(options.destFilename)
    : sanitizeLibraryFilename(path.basename(filePath));
  assertLibraryExtension(filename);
  const sizeBytes = fs.statSync(filePath).size;
  if (sizeBytes <= 0) throw new Error("LoRA file is empty.");
  const sha256 = hashFileSha256(filePath);
  const metadata = readSafetensorsMetadata(filePath);
  // Explicit --expect / expectArchitecture wins so installers can pin the Studio graph family
  // (e.g. SDXL pixel LoRA → illustrious) when metadata is ambiguous or mis-tagged.
  let architecture = options.expectArchitecture && options.expectArchitecture !== "unknown"
    ? options.expectArchitecture
    : inferLoraArchitecture(metadata, filename);
  if (architecture === "unknown" && options.expectArchitecture) {
    architecture = options.expectArchitecture;
  }
  const networkDim = metaNumber(metadata, ["ss_network_dim", "network_dim"]);
  const networkAlpha = metaNumber(metadata, ["ss_network_alpha", "network_alpha"]);
  const steps = metaNumber(metadata, ["ss_steps", "ss_max_train_steps"]);
  const epochs = metaNumber(metadata, ["ss_epoch", "ss_num_epochs"]);
  const learningRate = metaNumber(metadata, ["ss_learning_rate", "ss_unet_lr"]);
  const baseTrainingModel =
    metaString(metadata, ["ss_base_model_version", "modelspec.architecture", "ss_sd_model_name"])
    || (architecture === "krea2" ? "Krea 2" : architecture === "z-image" ? "Z-Image" : undefined);
  const title = metaString(metadata, ["modelspec.title", "ss_output_name", "name"]);
  const software = metaString(metadata, ["software"]);
  const markVerified = options.markVerified !== false && architecture !== "unknown";

  const record: LoraRecord = {
    filename,
    displayName: options.displayName || title || filename.replace(/\.safetensors$/i, ""),
    architecture,
    category: options.category,
    tags: options.tags || [],
    activationWords: options.activationWords || [],
    usageGuide: options.usageGuide,
    sha256,
    baseTrainingModel,
    trainer: software,
    rank: networkDim,
    alpha: networkAlpha,
    steps,
    epochs,
    learningRate,
    recommendedStrength: options.recommendedStrength ?? 0.7,
    verifiedAdapters: markVerified && architecture !== "unknown" && architecture !== "pony"
      ? [architecture]
      : architecture === "pony"
        ? ["pony"]
        : [],
    verified: markVerified,
    createdAt: new Date().toISOString(),
    notes: options.notes
      || `Installed via modular lora-install. Architecture=${architecture} (metadata keys: ${Object.keys(metadata).length}). Hash verified.`
  };
  return { record, metadata, sha256, sizeBytes };
}

/**
 * Copy a local .safetensors into project lora/ (never overwrite) and register it.
 */
export function installLoraFromPath(
  projectRoot: string,
  sourcePath: string,
  options: InstallLoraOptions = {}
): InstallLoraResult {
  const absSource = path.resolve(sourcePath);
  if (!fs.existsSync(absSource)) {
    throw new Error(`LoRA source not found: ${absSource}`);
  }
  const built = buildLoraRecordFromFile(absSource, options);
  // allowExisting so we can distinguish same-hash re-register vs different-hash conflict.
  const target = resolveLibraryTarget(projectRoot, "lora", built.record.filename, {
    allowExisting: true
  });
  const registry = new LoraRegistry(
    path.join(projectRoot, "data", "lora-registry.json"),
    path.join(projectRoot, "lora")
  );

  // If destination already exists with same hash, just upsert registry (idempotent re-register).
  if (fs.existsSync(target.finalPath)) {
    const existingHash = hashFileSha256(target.finalPath);
    if (existingHash !== built.sha256) {
      throw new Error(
        `Destination already exists with a different hash: ${target.filename}. Refusing to overwrite.`
      );
    }
    const record = registry.upsert(built.record);
    return {
      filename: target.filename,
      finalPath: target.finalPath,
      sha256: built.sha256,
      sizeBytes: built.sizeBytes,
      architecture: record.architecture,
      metadataKeys: Object.keys(built.metadata),
      record,
      alreadyExisted: true
    };
  }

  // Stage to temp then exclusive install (same pattern as library upload).
  const stagingDir = path.join(projectRoot, "data", "library-upload-staging");
  fs.mkdirSync(stagingDir, { recursive: true });
  const staging = path.join(stagingDir, `${Date.now()}-${path.basename(target.filename)}`);
  fs.copyFileSync(absSource, staging);
  const stagedHash = hashFileSha256(staging);
  if (stagedHash !== built.sha256) {
    try { fs.unlinkSync(staging); } catch { /* ignore */ }
    throw new Error("Staging copy hash mismatch — install aborted.");
  }
  installLibraryFile(staging, target.finalPath);
  const finalHash = hashFileSha256(target.finalPath);
  if (finalHash !== built.sha256) {
    throw new Error("Installed file hash mismatch — verify disk integrity.");
  }

  const record = registry.upsert(built.record);
  return {
    filename: target.filename,
    finalPath: target.finalPath,
    sha256: built.sha256,
    sizeBytes: built.sizeBytes,
    architecture: record.architecture,
    metadataKeys: Object.keys(built.metadata),
    record,
    alreadyExisted: false
  };
}

/**
 * Install every .safetensors under a directory (non-recursive by default).
 */
export function installLorasFromDirectory(
  projectRoot: string,
  directory: string,
  options: InstallLoraOptions & { recursive?: boolean } = {}
): InstallLoraResult[] {
  const abs = path.resolve(directory);
  if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) {
    throw new Error(`Not a directory: ${abs}`);
  }
  const names = options.recursive
    ? walkSafetensors(abs)
    : fs.readdirSync(abs)
      .filter(name => name.toLowerCase().endsWith(".safetensors"))
      .map(name => path.join(abs, name));
  return names.map(file => installLoraFromPath(projectRoot, file, options));
}

function walkSafetensors(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkSafetensors(full));
    else if (entry.isFile() && entry.name.toLowerCase().endsWith(".safetensors")) out.push(full);
  }
  return out;
}
