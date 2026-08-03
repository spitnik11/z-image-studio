import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildA1111Parameters,
  embedCivitaiMetadataInPngFile,
  injectPngTextMetadata,
  readPngTextMetadata,
  stripSafetensorsExt
} from "./civitai-metadata.js";

const temps: string[] = [];

function tinyPng(): Buffer {
  // Minimal valid 1x1 PNG
  return Buffer.from(
    "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c63000100000500010d0a2db40000000049454e44ae426082",
    "hex"
  );
}

afterEach(() => {
  for (const dir of temps.splice(0)) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  }
});

describe("civitai A1111 metadata", () => {
  it("builds parameters with model, hashes, and LoRA tags for Civitai auto-detection", () => {
    const text = buildA1111Parameters(
      {
        prompt: "anime girl, detailed",
        negativePrompt: "low quality",
        width: 1024,
        height: 1024,
        seed: 42,
        steps: 30,
        guidance: 4,
        sampler: "euler",
        scheduler: "simple",
        diffusionModel: "galenaCATGalenaCitronAnime_animaV1.safetensors",
        loras: [{ name: "V1.safetensors", strength: 0.9 }]
      },
      {
        modelHash: "aabbccddee1122334455",
        loraHashes: { "V1.safetensors": "ffeeddccbbaa99887766" }
      }
    );
    expect(text).toContain("anime girl, detailed");
    expect(text).toContain("<lora:V1:0.9>");
    expect(text).toContain("Negative prompt: low quality");
    expect(text).toContain("Steps: 30");
    expect(text).toContain("Sampler: Euler");
    expect(text).toContain("CFG scale: 4");
    expect(text).toContain("Seed: 42");
    expect(text).toContain("Size: 1024x1024");
    expect(text).toContain("Model: galenaCATGalenaCitronAnime_animaV1");
    expect(text).toContain("Model hash: AABBCCDDEE");
    expect(text).toMatch(/Hashes: \{.*"model":"AABBCCDDEE".*\}/);
    expect(text).toContain('"lora:V1":"FFEEDDCCBB"');
    expect(text).toContain("Version: Z-Image Studio");
  });

  it("does not duplicate existing LoRA tags in the prompt", () => {
    const text = buildA1111Parameters({
      prompt: "subject <lora:V1:0.8>",
      diffusionModel: "m.safetensors",
      loras: [{ name: "V1.safetensors", strength: 0.8 }],
      steps: 8,
      guidance: 1,
      seed: 1,
      width: 512,
      height: 512,
      sampler: "euler"
    });
    expect(text.match(/<lora:V1:/g)?.length).toBe(1);
  });

  it("injects parameters into PNG while preserving other chunks", () => {
    const withPrompt = injectPngTextMetadata(tinyPng(), { prompt: "{\"1\":{}}" });
    const withBoth = injectPngTextMetadata(withPrompt, {
      parameters: "test prompt\nSteps: 8, Model: demo"
    });
    const meta = readPngTextMetadata(withBoth);
    expect(meta.prompt).toBe("{\"1\":{}}");
    expect(meta.parameters).toContain("Steps: 8");
    expect(meta.parameters).toContain("Model: demo");
  });

  it("embeds metadata into a real PNG file on disk", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "civitai-meta-"));
    temps.push(dir);
    const file = path.join(dir, "out.png");
    fs.writeFileSync(file, tinyPng());
    const ok = embedCivitaiMetadataInPngFile(file, {
      prompt: "hello",
      diffusionModel: "model.safetensors",
      steps: 20,
      guidance: 7,
      seed: 99,
      width: 512,
      height: 768,
      sampler: "dpmpp_sde",
      scheduler: "karras",
      loras: [{ name: "style.safetensors", strength: 0.75 }]
    }, { modelHash: "1234567890abcdef", loraHashes: { "style.safetensors": "abcdef1234567890" } });
    expect(ok).toBe(true);
    const meta = readPngTextMetadata(fs.readFileSync(file));
    expect(meta.parameters).toContain("hello");
    expect(meta.parameters).toContain("<lora:style:0.75>");
    expect(meta.parameters).toContain("Model: model");
    expect(meta.parameters).toContain("DPM++ SDE Karras");
    expect(stripSafetensorsExt("x.safetensors")).toBe("x");
  });
});
