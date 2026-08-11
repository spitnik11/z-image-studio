import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { hashFileSha256, installLoraFromPath, buildLoraRecordFromFile } from "./lora-install.js";
import { inferLoraArchitecture } from "./lora-registry.js";

const temps: string[] = [];
afterEach(() => {
  for (const dir of temps.splice(0)) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

function fakeSafetensors(file: string, metadata: Record<string, string> = {}) {
  // Minimal safetensors: 8-byte header length + JSON header with __metadata__ + tiny tensor body
  const headerObj = {
    __metadata__: metadata,
    "weight": { dtype: "F16", shape: [1], data_offsets: [0, 2] }
  };
  const header = Buffer.from(JSON.stringify(headerObj), "utf8");
  const len = Buffer.alloc(8);
  len.writeBigUInt64LE(BigInt(header.length));
  const body = Buffer.alloc(2);
  fs.writeFileSync(file, Buffer.concat([len, header, body]));
}

describe("inferLoraArchitecture", () => {
  it("recognizes krea2 from metadata and spaced filename", () => {
    expect(inferLoraArchitecture({ ss_base_model_version: "krea2" }, "x.safetensors")).toBe("krea2");
    expect(inferLoraArchitecture({}, "Krea 2 - Flat Chested v3.safetensors")).toBe("krea2");
    expect(inferLoraArchitecture({}, "something.safetensors")).toBe("unknown");
  });
});

describe("installLoraFromPath", () => {
  it("copies, hashes, registers as krea2, and never overwrites a different file", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "lora-install-"));
    temps.push(root);
    fs.mkdirSync(path.join(root, "lora"), { recursive: true });
    fs.mkdirSync(path.join(root, "data"), { recursive: true });
    const src = path.join(root, "src-Krea 2 - Flat Chested v3.safetensors");
    fakeSafetensors(src, { ss_base_model_version: "krea2" });

    const result = installLoraFromPath(root, src, {
      expectArchitecture: "krea2",
      displayName: "Flat Chested Krea 2 v3",
      category: "body",
      recommendedStrength: 0.7
    });
    expect(result.architecture).toBe("krea2");
    expect(result.alreadyExisted).toBe(false);
    expect(fs.existsSync(result.finalPath)).toBe(true);
    expect(hashFileSha256(result.finalPath)).toBe(result.sha256);
    expect(result.record.verified).toBe(true);
    expect(result.record.verifiedAdapters).toContain("krea2");

    const registry = JSON.parse(fs.readFileSync(path.join(root, "data", "lora-registry.json"), "utf8"));
    expect(registry.some((r: { filename: string }) => r.filename === result.filename)).toBe(true);

    // Same hash re-register is idempotent
    const again = installLoraFromPath(root, src, { expectArchitecture: "krea2" });
    expect(again.alreadyExisted).toBe(true);

    // Different content same name must refuse overwrite
    const other = path.join(root, "other.safetensors");
    fakeSafetensors(other, { ss_base_model_version: "krea2", name: "different" });
    // Force same dest name via copy to a different source that builds same filename
    const clashSrc = path.join(root, result.filename);
    fs.copyFileSync(other, clashSrc);
    // Destination already has original; installing different hash with same basename should throw
    expect(() => installLoraFromPath(root, clashSrc, { expectArchitecture: "krea2" })).toThrow(/different hash|already exists/i);
  });

  it("buildLoraRecordFromFile uses expectArchitecture when metadata is empty", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lora-build-"));
    temps.push(dir);
    const file = path.join(dir, "no-meta.safetensors");
    fakeSafetensors(file, {});
    const built = buildLoraRecordFromFile(file, { expectArchitecture: "krea2" });
    expect(built.record.architecture).toBe("krea2");
  });
});
