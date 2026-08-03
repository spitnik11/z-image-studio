import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

export type CivitaiMetaInput = {
  prompt?: string;
  negativePrompt?: string;
  width?: number;
  height?: number;
  seed?: number;
  steps?: number;
  guidance?: number;
  sampler?: string;
  scheduler?: string;
  diffusionModel?: string;
  model?: string;
  vae?: string;
  textEncoder?: string;
  loras?: Array<{ name: string; strength?: number }>;
};

export type ResourceHashLookup = {
  /** Precomputed or catalog SHA-256 (full or short). */
  modelHash?: string;
  /** Map of LoRA filename (with or without extension) → SHA-256. */
  loraHashes?: Record<string, string>;
  vaeHash?: string;
};

const hashCache = new Map<string, { mtimeMs: number; size: number; sha256: string }>();

/** A1111 / Civitai-friendly sampler labels. */
export function civitaiSamplerName(sampler?: string, scheduler?: string): string {
  const s = String(sampler || "euler").toLowerCase();
  const map: Record<string, string> = {
    euler: "Euler",
    euler_ancestral: "Euler a",
    dpmpp_2m: "DPM++ 2M",
    dpmpp_sde: "DPM++ SDE",
    res_multistep: "res_multistep"
  };
  let name = map[s] || sampler || "Euler";
  if (scheduler && /karras/i.test(scheduler) && !/karras/i.test(name)) name = `${name} Karras`;
  return name;
}

export function stripSafetensorsExt(name: string): string {
  return String(name || "").replace(/\.safetensors$/i, "");
}

/**
 * Build Automatic1111-style "parameters" text that Civitai geninfo auto-detection expects.
 * Includes Model / Model hash / LoRA tags in the prompt / Hashes JSON when available.
 */
export function buildA1111Parameters(input: CivitaiMetaInput, hashes: ResourceHashLookup = {}): string {
  const modelFile = String(input.diffusionModel || input.model || "").trim();
  const modelBase = stripSafetensorsExt(path.basename(modelFile));
  const loras = Array.isArray(input.loras) ? input.loras.filter(item => item?.name) : [];

  let positive = String(input.prompt || "").trim();
  for (const lora of loras) {
    const tagName = stripSafetensorsExt(path.basename(lora.name));
    const strength = Number.isFinite(Number(lora.strength)) ? Number(lora.strength) : 1;
    const tag = `<lora:${tagName}:${trimStrength(strength)}>`;
    // Avoid duplicating an identical tag already present in the prompt.
    if (!positive.toLowerCase().includes(`<lora:${tagName.toLowerCase()}:`)) {
      positive = positive ? `${positive}, ${tag}` : tag;
    }
  }

  const negative = String(input.negativePrompt || "").trim();
  const steps = Number(input.steps) || 0;
  const cfg = Number(input.guidance);
  const seed = Number(input.seed) || 0;
  const width = Number(input.width) || 0;
  const height = Number(input.height) || 0;
  const sampler = civitaiSamplerName(input.sampler, input.scheduler);

  const modelHash = normalizeHash(hashes.modelHash);
  const hashMap: Record<string, string> = {};
  if (modelHash) hashMap.model = modelHash.slice(0, 10).toUpperCase();
  for (const lora of loras) {
    const key = stripSafetensorsExt(path.basename(lora.name));
    const fromLookup =
      hashes.loraHashes?.[lora.name] ||
      hashes.loraHashes?.[key] ||
      hashes.loraHashes?.[`${key}.safetensors`];
    const h = normalizeHash(fromLookup);
    if (h) hashMap[`lora:${key}`] = h.slice(0, 10).toUpperCase();
  }
  if (hashes.vaeHash) {
    const vh = normalizeHash(hashes.vaeHash);
    if (vh) hashMap[`vae:${stripSafetensorsExt(path.basename(String(input.vae || "vae")))}`] = vh.slice(0, 10).toUpperCase();
  }

  const lines: string[] = [positive || " "];
  if (negative) lines.push(`Negative prompt: ${negative}`);

  const parts = [
    `Steps: ${steps}`,
    `Sampler: ${sampler}`,
    `CFG scale: ${Number.isFinite(cfg) ? cfg : 1}`,
    `Seed: ${seed}`,
    `Size: ${width}x${height}`
  ];
  if (modelHash) parts.push(`Model hash: ${modelHash.slice(0, 10).toUpperCase()}`);
  if (modelBase) parts.push(`Model: ${modelBase}`);
  if (Object.keys(hashMap).length) {
    parts.push(`Hashes: ${JSON.stringify(hashMap)}`);
  }
  parts.push("Version: Z-Image Studio");
  lines.push(parts.join(", "));
  return lines.join("\n");
}

function trimStrength(value: number): string {
  if (Number.isInteger(value)) return String(value);
  return String(Math.round(value * 1000) / 1000);
}

function normalizeHash(value?: string): string | undefined {
  if (!value) return undefined;
  const clean = String(value).trim().replace(/^0x/i, "").toLowerCase();
  if (!/^[0-9a-f]{8,64}$/i.test(clean)) return undefined;
  return clean;
}

/** CRC32 used by PNG chunk encoding. */
function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return (c ^ 0xffffffff) >>> 0;
}

function pngTextChunk(keyword: string, text: string): Buffer {
  const key = Buffer.from(keyword, "latin1");
  const val = Buffer.from(text, "utf8");
  // PNG tEXt is Latin-1 historically; long UTF-8 prompts use iTXt for safety when non-latin1.
  const useItxt = !/^[\x00-\xFF]*$/.test(text) || val.length > 0 && /[^\x00-\x7F]/.test(text);
  if (!useItxt) {
    const data = Buffer.concat([key, Buffer.from([0]), val]);
    return packChunk("tEXt", data);
  }
  // iTXt: keyword\0 compression_flag\0 compression_method\0 language\0 translated\0 text
  const data = Buffer.concat([
    key,
    Buffer.from([0, 0, 0, 0, 0]), // null, uncompressed, method 0, empty lang null, empty translated null
    val
  ]);
  return packChunk("iTXt", data);
}

function packChunk(type: string, data: Buffer): Buffer {
  const typeBuf = Buffer.from(type, "ascii");
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

/**
 * Insert or replace a PNG textual metadata chunk before IEND.
 * Preserves all other chunks (including ComfyUI prompt/workflow).
 */
export function injectPngTextMetadata(png: Buffer, fields: Record<string, string>): Buffer {
  if (png.length < 8 || png.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") {
    throw new Error("Not a PNG file.");
  }
  const parts: Buffer[] = [png.subarray(0, 8)];
  let offset = 8;
  const skipKeys = new Set(Object.keys(fields).map(k => k.toLowerCase()));
  let iend: Buffer | undefined;

  while (offset + 12 <= png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.toString("ascii", offset + 4, offset + 8);
    const chunkEnd = offset + 12 + length;
    if (chunkEnd > png.length) break;
    const chunk = png.subarray(offset, chunkEnd);
    offset = chunkEnd;

    if (type === "IEND") {
      iend = chunk;
      break;
    }

    if (type === "tEXt" || type === "iTXt" || type === "zTXt") {
      const data = chunk.subarray(8, 8 + length);
      const nullAt = data.indexOf(0);
      const key = (nullAt >= 0 ? data.subarray(0, nullAt) : data).toString("latin1").toLowerCase();
      if (skipKeys.has(key)) continue; // replace
    }
    parts.push(chunk);
  }

  for (const [key, value] of Object.entries(fields)) {
    if (!value) continue;
    parts.push(pngTextChunk(key, value));
  }
  parts.push(iend || packChunk("IEND", Buffer.alloc(0)));
  return Buffer.concat(parts);
}

/** Read existing PNG textual metadata keys (for tests / diagnostics). */
export function readPngTextMetadata(png: Buffer): Record<string, string> {
  const out: Record<string, string> = {};
  if (png.length < 8) return out;
  let offset = 8;
  while (offset + 12 <= png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.toString("ascii", offset + 4, offset + 8);
    const data = png.subarray(offset + 8, offset + 8 + length);
    offset += 12 + length;
    if (type === "IEND") break;
    if (type === "tEXt") {
      const nullAt = data.indexOf(0);
      if (nullAt < 0) continue;
      out[data.toString("utf8", 0, nullAt)] = data.toString("utf8", nullAt + 1);
    } else if (type === "iTXt") {
      const nullAt = data.indexOf(0);
      if (nullAt < 0) continue;
      const key = data.toString("utf8", 0, nullAt);
      // skip compression flag, method, lang, translated
      let p = nullAt + 1;
      const compressed = data[p]; p += 2; // flag + method
      const langEnd = data.indexOf(0, p); p = langEnd + 1;
      const trEnd = data.indexOf(0, p); p = trEnd + 1;
      let text = data.subarray(p);
      if (compressed === 1) {
        try { text = zlib.inflateSync(text); } catch { continue; }
      }
      out[key] = text.toString("utf8");
    }
  }
  return out;
}

export function hashFileSha256(filePath: string): string {
  const stat = fs.statSync(filePath);
  const cached = hashCache.get(filePath);
  if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) return cached.sha256;

  const hash = crypto.createHash("sha256");
  const fd = fs.openSync(filePath, "r");
  try {
    const buf = Buffer.alloc(1024 * 1024);
    let bytes = 0;
    while ((bytes = fs.readSync(fd, buf, 0, buf.length, null)) > 0) {
      hash.update(buf.subarray(0, bytes));
    }
  } finally {
    fs.closeSync(fd);
  }
  const sha256 = hash.digest("hex");
  hashCache.set(filePath, { mtimeMs: stat.mtimeMs, size: stat.size, sha256 });
  return sha256;
}

export function resolveResourcePath(projectRoot: string, kind: "model" | "lora" | "vae", filename: string): string | undefined {
  const base = path.basename(filename);
  const candidates =
    kind === "lora"
      ? [path.join(projectRoot, "lora", base), path.join(projectRoot, "ComfyUI", "models", "loras", base)]
      : kind === "vae"
        ? [
            path.join(projectRoot, base),
            path.join(projectRoot, "ComfyUI", "models", "vae", base)
          ]
        : [
            path.join(projectRoot, base),
            path.join(projectRoot, "checkpoints", base),
            path.join(projectRoot, "ComfyUI", "models", "diffusion_models", base),
            path.join(projectRoot, "ComfyUI", "models", "checkpoints", base)
          ];
  return candidates.find(item => fs.existsSync(item));
}

/**
 * Resolve hashes from optional known maps first (catalog/registry), then hash local files.
 * Never throws for missing files — omits those hashes.
 */
export function collectResourceHashes(
  projectRoot: string,
  input: CivitaiMetaInput,
  known: { model?: string; loras?: Record<string, string>; vae?: string } = {}
): ResourceHashLookup {
  const result: ResourceHashLookup = { loraHashes: {} };
  const modelName = String(input.diffusionModel || input.model || "");
  if (known.model) result.modelHash = normalizeHash(known.model);
  else if (modelName) {
    const file = resolveResourcePath(projectRoot, "model", modelName);
    if (file) {
      try { result.modelHash = hashFileSha256(file); } catch { /* omit */ }
    }
  }

  for (const lora of input.loras || []) {
    const name = lora.name;
    const knownHash = known.loras?.[name] || known.loras?.[stripSafetensorsExt(name)];
    if (knownHash) {
      result.loraHashes![name] = normalizeHash(knownHash) || knownHash;
      continue;
    }
    const file = resolveResourcePath(projectRoot, "lora", name);
    if (!file) continue;
    try { result.loraHashes![name] = hashFileSha256(file); } catch { /* omit */ }
  }

  if (known.vae) result.vaeHash = normalizeHash(known.vae);
  else if (input.vae) {
    const file = resolveResourcePath(projectRoot, "vae", input.vae);
    if (file) {
      try { result.vaeHash = hashFileSha256(file); } catch { /* omit */ }
    }
  }
  return result;
}

/**
 * Write Civitai-oriented A1111 parameters into a PNG on disk (in place).
 * No-ops for non-PNG. Returns true if the file was updated.
 */
export function embedCivitaiMetadataInPngFile(
  imagePath: string,
  input: CivitaiMetaInput,
  hashes: ResourceHashLookup = {}
): boolean {
  if (!/\.png$/i.test(imagePath) || !fs.existsSync(imagePath)) return false;
  const original = fs.readFileSync(imagePath);
  const parameters = buildA1111Parameters(input, hashes);
  const next = injectPngTextMetadata(original, {
    parameters,
    // Some tools also look at "Comment"
    Comment: parameters
  });
  // Atomic-ish replace: write temp then rename within same directory.
  const temp = path.join(path.dirname(imagePath), `.${path.basename(imagePath)}.${crypto.randomUUID()}.tmp`);
  fs.writeFileSync(temp, next);
  fs.renameSync(temp, imagePath);
  return true;
}
