import fs from "node:fs";
import path from "node:path";
import type { ImageArchitecture } from "./model-adapters.js";
import { writeJsonAtomic } from "./file-utils.js";

export type LoraArchitecture = ImageArchitecture | "pony" | "unknown";
export type LoraCategory = "character" | "body" | "style" | "realism" | "action" | "concept" | "utility" | "other";
export type LoraRecord = {
  filename: string;
  displayName?: string;
  architecture: LoraArchitecture;
  category?: LoraCategory;
  tags?: string[];
  aestheticTags?: string[];
  incompatibleWith?: string[];
  conflictingActivations?: string[];
  incompatibleAesthetics?: string[];
  exclusiveGroup?: string;
  activationWords?: string[];
  usageGuide?: string;
  promptTemplate?: string;
  sourceUrl?: string;
  sourceModelId?: number;
  sourceVersionId?: number;
  sha256?: string;
  licenseNotes?: string;
  baseTrainingModel?: string;
  trainer?: string;
  triggerToken?: string;
  datasetId?: string;
  datasetVersion?: string;
  trainingResolution?: string;
  rank?: number;
  alpha?: number;
  steps?: number;
  epochs?: number;
  learningRate?: number;
  textEncoderLearningRate?: number;
  createdAt?: string;
  recommendedStrength?: number;
  verifiedAdapters?: Array<ImageArchitecture | "pony">;
  verified: boolean;
  notes?: string;
};

export function applyLoraActivations(
  prompt: string,
  loras: Array<{ name: string }>,
  records: LoraRecord[]
) {
  const byName = new Map(records.map(record => [record.filename.toLowerCase(), record]));
  const promptWords = prompt.split(",").map(word => word.trim().toLowerCase()).filter(Boolean);
  const seen = new Set(promptWords);
  const activations: string[] = [];
  for (const lora of loras) {
    const record = byName.get(lora.name.toLowerCase());
    for (const word of record?.activationWords || []) {
      const clean = word.trim();
      if (!clean || seen.has(clean.toLowerCase())) continue;
      seen.add(clean.toLowerCase());
      activations.push(clean);
    }
  }
  return [...activations, prompt.trim()].filter(Boolean).join(", ");
}

export function readSafetensorsMetadata(file: string): Record<string, unknown> {
  try {
    const handle = fs.openSync(file, "r");
    const lengthBuffer = Buffer.alloc(8);
    fs.readSync(handle, lengthBuffer, 0, 8, 0);
    const headerLength = Number(lengthBuffer.readBigUInt64LE());
    if (!Number.isSafeInteger(headerLength) || headerLength < 2 || headerLength > 16 * 1024 * 1024) {
      fs.closeSync(handle); return {};
    }
    const header = Buffer.alloc(headerLength);
    fs.readSync(handle, header, 0, headerLength, 8);
    fs.closeSync(handle);
    return JSON.parse(header.toString("utf8")).__metadata__ || {};
  } catch { return {}; }
}

/**
 * Classify LoRA architecture from embedded safetensors metadata first, then filename.
 * Accepts common spellings: krea2, krea_2, "krea 2".
 * Never invent architecture from vague product marketing alone.
 */
export function inferLoraArchitecture(metadata: Record<string, unknown> = {}, filename = ""): LoraArchitecture {
  const text = `${filename} ${JSON.stringify(metadata)}`.toLowerCase();
  if (
    text.includes("krea2")
    || text.includes("krea_2")
    || text.includes("krea 2")
    || /["']architecture["']\s*:\s*["']krea/.test(text)
    || text.includes("krea-2-raw")
    || text.includes("krea/krea")
  ) {
    return "krea2";
  }
  if (text.includes("z-image") || text.includes("z_image") || text.includes("zimage") || text.includes("z-image turbo")) {
    return "z-image";
  }
  if (text.includes("anima")) return "anima";
  if (text.includes("illustrious") || text.includes("noobai") || text.includes("ixl")) return "illustrious";
  // Pony / SDXL LoRAs (e.g. ArsMJStylePony pixel art) — registry may use "pony" or
  // "illustrious"; install path can force expectArchitecture when stacking on SDXL graph.
  if (text.includes("pony") || text.includes("ponydiffusion") || text.includes("arsmjstylepony")) return "pony";
  if (
    text.includes("stable-diffusion-xl")
    || text.includes("sdxl_base")
    || text.includes("sdxl-base")
    || text.includes("/lora") && text.includes("sdxl")
  ) {
    // SDXL LoRAs without Pony tags still load on Illustrious/SDXL checkpoint graph.
    return "illustrious";
  }
  return "unknown";
}

/** @deprecated Prefer inferLoraArchitecture */
function inferArchitecture(metadata: Record<string, unknown>, filename = ""): LoraArchitecture {
  return inferLoraArchitecture(metadata, filename);
}

export class LoraRegistry {
  constructor(private readonly file: string, private readonly loraDirectory: string) {}

  list(availableNames: string[] = []): LoraRecord[] {
    const saved = this.load();
    const byName = new Map(saved.map(item => [item.filename.toLowerCase(), item]));
    for (const filename of availableNames) {
      if (byName.has(filename.toLowerCase())) continue;
      const metadata = readSafetensorsMetadata(path.join(this.loraDirectory, filename));
      const architecture = inferArchitecture(metadata, filename);
      byName.set(filename.toLowerCase(), { filename, architecture, verified: false });
    }
    return [...byName.values()].sort((a, b) => a.filename.localeCompare(b.filename));
  }

  compatible(architecture: ImageArchitecture, availableNames: string[] = []) {
    return this.list(availableNames).filter(item => item.architecture === architecture && item.verified);
  }

  upsert(input: LoraRecord) {
    const records = this.load();
    const index = records.findIndex(item => item.filename.toLowerCase() === input.filename.toLowerCase());
    if (index >= 0) records[index] = input; else records.push(input);
    this.save(records);
    return input;
  }

  private load(): LoraRecord[] {
    try { return JSON.parse(fs.readFileSync(this.file, "utf8")); } catch { return []; }
  }

  private save(records: LoraRecord[]) {
    writeJsonAtomic(this.file, records);
  }
}
