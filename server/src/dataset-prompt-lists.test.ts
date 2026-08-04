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
    expect(list.prompts[0]).toMatch(/Raw photo/i);
    expect(list.prompts[0]).toMatch(/lili doe/i);
    expect(list.prompts[0]).toMatch(/close-up pouty mirror selfie/i);
    expect(list.prompts[39]).toMatch(/full-body standing full frontal/i);
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
    expect(prompts[0].caption).toMatch(/Raw photo/i);
    expect(prompts[0].caption).toMatch(/mirror selfie/i);
    expect(prompts[11].caption).toMatch(/kneeling on bed/i);
    expect(prompts[39].caption).toMatch(/full frontal/i);
    // Unique captions across the batch
    expect(new Set(prompts.map(p => p.caption)).size).toBe(40);
    // Trigger already in prompt body — avoid heavy double-prefix of basePrompt noise
    expect(prompts[0].caption.startsWith("Raw photo") || prompts[0].caption.includes("lili doe")).toBe(true);
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
});
