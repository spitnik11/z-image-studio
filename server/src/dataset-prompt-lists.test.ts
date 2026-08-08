import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  loadPromptList,
  promptIndexForSlot,
  replacePromptListPrompts,
  savePromptList,
  shuffledIndices
} from "./dataset-prompt-lists.js";
import {
  datasetPrompts,
  datasetSchema,
  resolveDatasetNegativePrompt,
  DEFAULT_NYX_LATEX_FETISH_NEGATIVE,
  DEFAULT_INSTAGRAM_UGC_NEGATIVE
} from "./dataset.js";

const temps: string[] = [];
afterEach(() => {
  for (const dir of temps.splice(0)) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

describe("dataset prompt lists", () => {
  it("loads the on-disk Instagram UGC list with 40 full prompts", () => {
    const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "../..");
    // Windows path from fileURL can be awkward — use process cwd relative for server package
    const projectRoot = path.resolve(process.cwd(), "..");
    const list = loadPromptList(projectRoot, "instagram-ugc");
    expect(list.prompts.length).toBe(40);
    expect(list.version).toBeGreaterThanOrEqual(6);
    expect(list.prompts[0]).toMatch(/Casual amateur phone snapshot/i);
    expect(list.prompts[0]).toMatch(/lili doe/i);
    expect(list.prompts[0]).toMatch(/dolphin shorts/i);
    expect(list.prompts[0]).toMatch(/streamer room/i);
    expect(list.prompts[0]).toMatch(/gaming chair/i);
    expect(list.prompts[39]).toMatch(/dolphin shorts/i);
    expect(list.prompts[39]).toMatch(/gaming setup|streamer room/i);
    expect(list.prompts[39]).toMatch(/mischievous smirk/i);
  });

  it("loads the on-disk Nyx latex fetish list with 10 preserved prompts", () => {
    const projectRoot = path.resolve(process.cwd(), "..");
    const list = loadPromptList(projectRoot, "nyx-latex-fetish");
    expect(list.id).toBe("nyx-latex-fetish");
    expect(list.prompts.length).toBe(10);
    expect(list.prompts[0]).toMatch(/Photorealistic extreme close-up of Nyx/i);
    expect(list.prompts[0]).toMatch(/full black latex hood/i);
    expect(list.prompts[0]).toMatch(/vividly red lips/i);
    expect(list.prompts[1]).toMatch(/smothering pose/i);
    expect(list.prompts[4]).toMatch(/sitting fully on the viewer's face|sitting fully on the viewer/i);
    expect(list.prompts[8]).toMatch(/slight hip tilt/i);
    expect(list.prompts[9]).toMatch(/smothering threat pose/i);
    expect(list.prompts.every(p => p.trim().length >= 8)).toBe(true);
    // Must not share Instagram UGC content
    expect(list.prompts.some(p => /lili doe|dolphin shorts|streamer room/i.test(p))).toBe(false);
  });

  it("replaces prompts via save path for manual updates", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "prompt-lists-"));
    temps.push(dir);
    const dataDir = path.join(dir, "data", "dataset-prompt-lists");
    fs.mkdirSync(dataDir, { recursive: true });
    savePromptList(dir, {
      id: "test-list",
      name: "Test",
      version: 1,
      prompts: ["prompt one alpha", "prompt two beta", "prompt three gamma"]
    });
    const updated = replacePromptListPrompts(dir, "test-list", [
      "replaced first",
      "replaced second"
    ]);
    expect(updated.version).toBe(2);
    expect(updated.prompts).toEqual(["replaced first", "replaced second"]);
    expect(loadPromptList(dir, "test-list").prompts[0]).toBe("replaced first");
  });

  it("maps sequential slots one-by-one without duplicates in a full cycle", () => {
    const seen = new Set<number>();
    for (let slot = 0; slot < 40; slot++) {
      const { listIndex } = promptIndexForSlot(slot, 40, "sequential", 42);
      expect(listIndex).toBe(slot);
      seen.add(listIndex);
    }
    expect(seen.size).toBe(40);
  });

  it("wraps short lists (e.g. 10 prompts) so slots past the end restart at 0", () => {
    const listLength = 10;
    // First full cycle
    for (let slot = 0; slot < listLength; slot++) {
      const { listIndex, cycle } = promptIndexForSlot(slot, listLength, "sequential", 1);
      expect(listIndex).toBe(slot);
      expect(cycle).toBe(0);
    }
    // Second cycle restarts
    for (let slot = listLength; slot < listLength * 2; slot++) {
      const { listIndex, cycle } = promptIndexForSlot(slot, listLength, "sequential", 1);
      expect(listIndex).toBe(slot % listLength);
      expect(cycle).toBe(1);
    }
    // 12-image build over 10 prompts: indices 0..9,0,1
    const twelve = Array.from({ length: 12 }, (_, slot) => promptIndexForSlot(slot, listLength, "sequential", 7).listIndex);
    expect(twelve).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 0, 1]);
    // 24 and 40 wrap cleanly without going out of range
    for (const count of [12, 24, 40]) {
      const indices = Array.from({ length: count }, (_, slot) => promptIndexForSlot(slot, listLength, "sequential", 3).listIndex);
      expect(indices.every(i => i >= 0 && i < listLength)).toBe(true);
      expect(indices[0]).toBe(0);
      expect(indices[listLength]).toBe(0);
      expect(indices[listLength - 1]).toBe(listLength - 1);
    }
  });

  it("shuffle mode is deterministic and unique within a cycle", () => {
    const a = shuffledIndices(40, 99);
    const b = shuffledIndices(40, 99);
    const c = shuffledIndices(40, 100);
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
    expect(new Set(a).size).toBe(40);
    const firstCycle = Array.from({ length: 40 }, (_, slot) => promptIndexForSlot(slot, 40, "shuffle", 7).listIndex);
    expect(new Set(firstCycle).size).toBe(40);
  });

  it("datasetPrompts sequential attaches a distinct list prompt to each image in order", () => {
    const projectRoot = path.resolve(process.cwd(), "..");
    const input = datasetSchema.parse({
      name: "Order Test",
      trigger: "lili doe",
      model: "krea2.safetensors",
      basePrompt: "unused when full prompts include identity",
      count: 40,
      width: 512,
      height: 768,
      seed: 10,
      datasetMode: "instagram-ugc",
      promptOrder: "sequential",
      promptListId: "instagram-ugc",
      projectRoot
    });
    const prompts = datasetPrompts(input);
    expect(prompts).toHaveLength(40);
    // Each image gets a different list index in order
    expect(prompts.map(p => p.listIndex)).toEqual(Array.from({ length: 40 }, (_, i) => i));
    // Captions are the full generation prompts (not only short shot tags)
    expect(prompts[0].caption).toMatch(/Casual amateur phone snapshot/i);
    expect(prompts[0].caption).toMatch(/dolphin shorts/i);
    expect(prompts[11].caption).toMatch(/gaming|desk|streamer|dolphin/i);
    expect(prompts[39].caption).toMatch(/mischievous smirk|gaming setup/i);
    // Unique captions across the batch
    expect(new Set(prompts.map(p => p.caption)).size).toBe(40);
    // Trigger already in prompt body — avoid heavy double-prefix of basePrompt noise
    expect(prompts[0].caption.startsWith("Casual amateur") || prompts[0].caption.includes("lili doe")).toBe(true);
  });

  it("datasetPrompts shuffle still yields 40 unique prompts per full pass", () => {
    const projectRoot = path.resolve(process.cwd(), "..");
    const input = datasetSchema.parse({
      name: "Shuffle Test",
      trigger: "lili doe",
      model: "krea2.safetensors",
      basePrompt: "character",
      count: 40,
      width: 512,
      height: 768,
      seed: 12345,
      datasetMode: "instagram-ugc",
      promptOrder: "shuffle",
      projectRoot
    });
    const prompts = datasetPrompts(input);
    expect(new Set(prompts.map(p => p.listIndex)).size).toBe(40);
    expect(new Set(prompts.map(p => p.caption)).size).toBe(40);
    // Not the same order as sequential
    const sequential = datasetPrompts({ ...input, promptOrder: "sequential" });
    expect(prompts.map(p => p.listIndex)).not.toEqual(sequential.map(p => p.listIndex));
  });

  it("Nyx first-class mode uses its own list, wraps, and keeps Instagram separate", () => {
    const projectRoot = path.resolve(process.cwd(), "..");
    const base = datasetSchema.parse({
      name: "Nyx Wrap",
      trigger: "nyx",
      model: "krea2.safetensors",
      basePrompt: "same adult woman latex identity",
      count: 12,
      width: 1530,
      height: 2048,
      seed: 99,
      datasetMode: "nyx-latex-fetish",
      promptOrder: "sequential",
      // Even if IG id is sent, Nyx mode must coerce to Nyx list
      promptListId: "instagram-ugc",
      projectRoot
    });
    expect(base.datasetMode).toBe("nyx-latex-fetish");
    expect(base.width).toBe(1530);
    expect(base.height).toBe(2048);
    const twelve = datasetPrompts(base);
    expect(twelve).toHaveLength(12);
    expect(twelve.map(p => p.listIndex)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 0, 1]);
    expect(twelve[0].caption).toMatch(/Nyx/i);
    expect(twelve[0].caption).toMatch(/red lips|latex/i);
    expect(twelve[0].caption).not.toMatch(/lili doe|dolphin shorts/i);
    expect((twelve[0].tags as Record<string, string>).mode).toBe("nyx-latex-fetish");
    expect(twelve[10].listIndex).toBe(0);
    expect(twelve[10].caption).toContain("alternate latex pass");
    expect(twelve[10].caption).not.toContain("Instagram pass");
    // NSFW negative does not ban nudity; Instagram still does
    expect(DEFAULT_NYX_LATEX_FETISH_NEGATIVE).not.toMatch(/\bnude\b/i);
    expect(DEFAULT_INSTAGRAM_UGC_NEGATIVE).toMatch(/\bnude\b/i);
    expect(resolveDatasetNegativePrompt("nyx-latex-fetish")).toBe(DEFAULT_NYX_LATEX_FETISH_NEGATIVE);
    expect(resolveDatasetNegativePrompt("instagram-ugc")).toBe(DEFAULT_INSTAGRAM_UGC_NEGATIVE);
    // Default size still validates
    const def = datasetSchema.parse({ ...base, width: 512, height: 768, count: 24, promptListId: "nyx-latex-fetish" });
    expect(def.width).toBe(512);
    const twentyFour = datasetPrompts(def);
    expect(twentyFour).toHaveLength(24);
    expect(twentyFour.map(p => p.listIndex)).toEqual([
      ...Array.from({ length: 10 }, (_, i) => i),
      ...Array.from({ length: 10 }, (_, i) => i),
      ...Array.from({ length: 4 }, (_, i) => i)
    ]);
    const forty = datasetPrompts({ ...def, count: 40 });
    expect(forty).toHaveLength(40);
    expect(forty.every(p => p.listIndex >= 0 && p.listIndex < 10)).toBe(true);
    expect(forty[39].listIndex).toBe(9);
  });


  it("different seeds produce different shuffle orders and different image noise seeds", () => {
    const projectRoot = path.resolve(process.cwd(), "..");
    const base = {
      name: "Seed Variety",
      trigger: "lili doe",
      model: "krea2.safetensors",
      basePrompt: "character",
      count: 12,
      width: 512,
      height: 768,
      datasetMode: "instagram-ugc" as const,
      promptOrder: "shuffle" as const,
      projectRoot
    };
    const a = datasetPrompts(datasetSchema.parse({ ...base, seed: 111 }));
    const b = datasetPrompts(datasetSchema.parse({ ...base, seed: 999 }));
    // Same fixed seed must be reproducible (not live Math.random)
    const aAgain = datasetPrompts(datasetSchema.parse({ ...base, seed: 111 }));
    expect(a.map(p => p.listIndex)).toEqual(aAgain.map(p => p.listIndex));
    expect(a.map(p => p.seed)).toEqual(aAgain.map(p => p.seed));
    // Different base seed → different permutation and different Comfy seeds
    expect(a.map(p => p.listIndex)).not.toEqual(b.map(p => p.listIndex));
    expect(a.map(p => p.seed)).not.toEqual(b.map(p => p.seed));
    expect(a[0].seed).toBe(111);
    expect(b[0].seed).toBe(999);
    // Sequential with same seed still reuses identical noise seeds across "runs"
    const seqA = datasetPrompts(datasetSchema.parse({ ...base, promptOrder: "sequential", seed: 42 }));
    const seqB = datasetPrompts(datasetSchema.parse({ ...base, promptOrder: "sequential", seed: 42 }));
    expect(seqA.map(p => p.seed)).toEqual(seqB.map(p => p.seed));
    expect(seqA.map(p => p.listIndex)).toEqual(seqB.map(p => p.listIndex));
  });
});
