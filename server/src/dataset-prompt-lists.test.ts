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
import { datasetPrompts, datasetSchema } from "./dataset.js";

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
