/**
 * Editable dataset prompt lists stored as JSON under data/dataset-prompt-lists/.
 * Replace prompts by editing the file or via PUT /api/datasets/prompt-lists/:id.
 */
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { writeJsonAtomic } from "./file-utils.js";

export const promptListSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/i),
  name: z.string().min(1).max(120),
  version: z.number().int().min(1).default(1),
  description: z.string().max(2000).optional(),
  updatedAt: z.string().optional(),
  prompts: z.array(z.string().trim().min(8).max(4000)).min(1).max(200)
});

export type PromptList = z.infer<typeof promptListSchema>;

const DEFAULT_LIST_ID = "instagram-ugc";

export function promptListsDir(projectRoot: string): string {
  return path.join(projectRoot, "data", "dataset-prompt-lists");
}

export function promptListPath(projectRoot: string, id: string): string {
  const safe = id.replace(/[^a-zA-Z0-9_-]/g, "");
  if (!safe || safe !== id) throw new Error("Invalid prompt list id.");
  return path.join(promptListsDir(projectRoot), `${safe}.json`);
}

export function listPromptLists(projectRoot: string): Array<{ id: string; name: string; version: number; count: number; updatedAt?: string }> {
  const dir = promptListsDir(projectRoot);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter(name => name.endsWith(".json"))
    .map(name => {
      try {
        const list = loadPromptList(projectRoot, name.replace(/\.json$/i, ""));
        return {
          id: list.id,
          name: list.name,
          version: list.version,
          count: list.prompts.length,
          updatedAt: list.updatedAt
        };
      } catch {
        return null;
      }
    })
    .filter(Boolean) as Array<{ id: string; name: string; version: number; count: number; updatedAt?: string }>;
}

export function loadPromptList(projectRoot: string, id = DEFAULT_LIST_ID): PromptList {
  const file = promptListPath(projectRoot, id);
  if (!fs.existsSync(file)) {
    throw new Error(`Prompt list not found: ${id}. Expected ${file}`);
  }
  const raw = JSON.parse(fs.readFileSync(file, "utf8"));
  return promptListSchema.parse(raw);
}

/** Load prompts for a list id; falls back to empty only when missing (caller may use built-in). */
export function loadPromptListSafe(projectRoot: string, id = DEFAULT_LIST_ID): PromptList | null {
  try {
    return loadPromptList(projectRoot, id);
  } catch {
    return null;
  }
}

export function savePromptList(projectRoot: string, list: PromptList): PromptList {
  const parsed = promptListSchema.parse({
    ...list,
    updatedAt: new Date().toISOString()
  });
  const dir = promptListsDir(projectRoot);
  fs.mkdirSync(dir, { recursive: true });
  const file = promptListPath(projectRoot, parsed.id);
  writeJsonAtomic(file, parsed);
  return parsed;
}

/**
 * Replace the entire prompt array for a list (manual update path).
 * Keeps id/name/version+1 unless version provided.
 */
export function replacePromptListPrompts(
  projectRoot: string,
  id: string,
  prompts: string[],
  meta?: { name?: string; description?: string }
): PromptList {
  const existing = loadPromptListSafe(projectRoot, id);
  const next: PromptList = promptListSchema.parse({
    id,
    name: meta?.name || existing?.name || id,
    version: (existing?.version || 0) + 1,
    description: meta?.description ?? existing?.description,
    updatedAt: new Date().toISOString(),
    prompts
  });
  return savePromptList(projectRoot, next);
}

/** Deterministic mulberry32 PRNG for shuffle mode. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher–Yates shuffle of indices [0..length) with deterministic seed. */
export function shuffledIndices(length: number, seed: number): number[] {
  const idx = Array.from({ length }, (_, i) => i);
  const rand = mulberry32(seed >>> 0 || 1);
  for (let i = length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [idx[i], idx[j]] = [idx[j], idx[i]];
  }
  return idx;
}

/**
 * Map variation slots to prompt indices.
 * sequential: 0,1,2,... wrapping each full cycle
 * shuffle: each full cycle is a deterministic permutation of the list (seeded by seed+cycle)
 */
export function promptIndexForSlot(
  slot: number,
  listLength: number,
  order: "sequential" | "shuffle",
  seed: number
): { listIndex: number; cycle: number; positionInCycle: number } {
  if (listLength <= 0) throw new Error("Prompt list is empty.");
  const cycle = Math.floor(slot / listLength);
  const positionInCycle = slot % listLength;
  if (order === "sequential") {
    return { listIndex: positionInCycle, cycle, positionInCycle };
  }
  const orderIdx = shuffledIndices(listLength, (seed + cycle * 10007) >>> 0);
  return { listIndex: orderIdx[positionInCycle], cycle, positionInCycle };
}

export const DEFAULT_PROMPT_LIST_ID = DEFAULT_LIST_ID;
