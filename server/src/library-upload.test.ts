import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  classifyLibraryModel,
  installLibraryFile,
  libraryDestinationDir,
  resolveLibraryTarget,
  sanitizeLibraryFilename,
  validateLibraryUpload,
  LibraryUploadError,
  LIBRARY_MAX_FILE_BYTES
} from "./library-upload.js";

describe("classifyLibraryModel", () => {
  it("classifies models by filename and reports trainer support", () => {
    expect(classifyLibraryModel("zImageTurbo_turbo.safetensors")).toEqual({ architecture: "z-image", trainable: true });
    expect(classifyLibraryModel("krea2Turbo.safetensors")).toEqual({ architecture: "krea2", trainable: true });
    expect(classifyLibraryModel("illustriousXL_v10.safetensors")).toEqual({ architecture: "illustrious", trainable: true });
    expect(classifyLibraryModel("something-random.safetensors").architecture).toBe("unknown");
  });
});

const temps: string[] = [];

function tempRoot() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "z-image-lib-upload-"));
  temps.push(dir);
  fs.mkdirSync(path.join(dir, "lora"), { recursive: true });
  fs.mkdirSync(path.join(dir, "checkpoints"), { recursive: true });
  return dir;
}

afterEach(() => {
  for (const dir of temps.splice(0)) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  }
});

describe("library upload validator", () => {
  it("rejects a bad extension", () => {
    const root = tempRoot();
    expect(() =>
      validateLibraryUpload({
        projectRoot: root,
        kind: "lora",
        originalName: "evil.txt",
        size: 100
      })
    ).toThrow(/safetensors/i);
  });

  it("strips path traversal / absolute wrappers so the resolved path stays inside the target folder", () => {
    const root = tempRoot();
    // Client-sent directory components are discarded; only the basename is used.
    expect(sanitizeLibraryFilename("../outside.safetensors")).toBe("outside.safetensors");
    expect(sanitizeLibraryFilename("..\\outside.safetensors")).toBe("outside.safetensors");
    expect(sanitizeLibraryFilename("C:\\abs\\model.safetensors")).toBe("model.safetensors");
    const resolved = resolveLibraryTarget(root, "lora", "..\\..\\Windows\\system32\\evil.safetensors");
    expect(resolved.finalPath).toBe(path.join(root, "lora", "evil.safetensors"));
    expect(resolved.finalPath.startsWith(path.join(root, "lora") + path.sep)).toBe(true);
    // Names that are only traversal tokens after basename are rejected.
    expect(() => sanitizeLibraryFilename("..")).toThrow(LibraryUploadError);
    expect(() => sanitizeLibraryFilename("")).toThrow(LibraryUploadError);
  });

  it("rejects a duplicate name and never overwrites", () => {
    const root = tempRoot();
    const existing = path.join(root, "lora", "already.safetensors");
    fs.writeFileSync(existing, "original");
    expect(() =>
      validateLibraryUpload({
        projectRoot: root,
        kind: "lora",
        originalName: "already.safetensors",
        size: 12
      })
    ).toThrow(/already exists/i);

    const staging = path.join(root, "stage.safetensors");
    fs.writeFileSync(staging, "replacement");
    expect(() => installLibraryFile(staging, existing)).toThrow(/already exists/i);
    expect(fs.readFileSync(existing, "utf8")).toBe("original");
  });

  it("accepts a valid .safetensors name and routes each kind to the correct folder", () => {
    const root = tempRoot();
    const lora = validateLibraryUpload({
      projectRoot: root,
      kind: "lora",
      originalName: "my-adapter.safetensors",
      size: 1024
    });
    expect(lora.destinationDir).toBe(path.join(root, "lora"));
    expect(lora.finalPath).toBe(path.join(root, "lora", "my-adapter.safetensors"));

    const diffusion = validateLibraryUpload({
      projectRoot: root,
      kind: "diffusion",
      originalName: "zImageTurbo_custom.safetensors",
      size: 1024
    });
    expect(diffusion.destinationDir).toBe(path.resolve(root));
    expect(diffusion.finalPath).toBe(path.join(path.resolve(root), "zImageTurbo_custom.safetensors"));

    const checkpoint = validateLibraryUpload({
      projectRoot: root,
      kind: "checkpoint",
      originalName: "illustriousCustom_v1.safetensors",
      size: 1024
    });
    expect(checkpoint.destinationDir).toBe(path.join(root, "checkpoints"));
    expect(checkpoint.finalPath).toBe(path.join(root, "checkpoints", "illustriousCustom_v1.safetensors"));

    expect(libraryDestinationDir(root, "lora")).toBe(path.join(root, "lora"));
    expect(libraryDestinationDir(root, "diffusion")).toBe(path.resolve(root));
    expect(libraryDestinationDir(root, "checkpoint")).toBe(path.join(root, "checkpoints"));
  });

  it("installs via exclusive copy then removes the staging file", () => {
    const root = tempRoot();
    const staging = path.join(root, "upload-temp.safetensors");
    const finalPath = path.join(root, "lora", "new-lora.safetensors");
    fs.writeFileSync(staging, "weights");
    installLibraryFile(staging, finalPath);
    expect(fs.readFileSync(finalPath, "utf8")).toBe("weights");
    expect(fs.existsSync(staging)).toBe(false);
  });

  it("rejects oversize and empty payloads", () => {
    const root = tempRoot();
    expect(() =>
      validateLibraryUpload({
        projectRoot: root,
        kind: "lora",
        originalName: "big.safetensors",
        size: LIBRARY_MAX_FILE_BYTES + 1
      })
    ).toThrow(/limit/i);
    expect(() =>
      validateLibraryUpload({
        projectRoot: root,
        kind: "lora",
        originalName: "empty.safetensors",
        size: 0
      })
    ).toThrow(/empty/i);
  });

  it("rejects an invalid kind", () => {
    const root = tempRoot();
    expect(() =>
      validateLibraryUpload({
        projectRoot: root,
        kind: "vae",
        originalName: "x.safetensors",
        size: 10
      })
    ).toThrow(/kind/i);
  });
});
