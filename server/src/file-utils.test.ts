import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { findLibraryResource, resolveInside, writeJsonAtomic } from "./file-utils.js";

describe("safe persistent files", () => {
  it("rejects a traversal outside the intended root", () => {
    const root = path.join(os.tmpdir(), "z-image-safe-root");
    expect(() => resolveInside(root, "..", "outside.json")).toThrow(/escapes/);
  });

  it("atomically replaces JSON and retains the previous version", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "z-image-atomic-"));
    const file = path.join(directory, "state.json");
    writeJsonAtomic(file, { version: 1 });
    writeJsonAtomic(file, { version: 2 });
    expect(JSON.parse(fs.readFileSync(file, "utf8"))).toEqual({ version: 2 });
    expect(JSON.parse(fs.readFileSync(`${file}.bak`, "utf8"))).toEqual({ version: 1 });
  });

  it("finds model and LoRA files for mtime/size metadata", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "z-image-lib-meta-"));
    fs.mkdirSync(path.join(root, "lora"), { recursive: true });
    fs.mkdirSync(path.join(root, "checkpoints"), { recursive: true });
    fs.writeFileSync(path.join(root, "lora", "adapter.safetensors"), "lora");
    fs.writeFileSync(path.join(root, "model.safetensors"), "model");
    fs.writeFileSync(path.join(root, "checkpoints", "ckpt.safetensors"), "ckpt");
    const lora = findLibraryResource(root, "lora", "adapter.safetensors");
    const model = findLibraryResource(root, "model", "model.safetensors");
    const ckpt = findLibraryResource(root, "model", "ckpt.safetensors");
    expect(lora?.size).toBe(4);
    expect(model?.size).toBe(5);
    expect(ckpt?.size).toBe(4);
    expect(lora?.mtimeMs).toBeGreaterThan(0);
    expect(findLibraryResource(root, "lora", "missing.safetensors")).toBeUndefined();
  });
});
