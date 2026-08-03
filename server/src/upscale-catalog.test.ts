import { describe, expect, it } from "vitest";
import {
  DEFAULT_UPSCALE_MODEL,
  UPSCALE_CATALOG,
  listUpscaleCatalog,
  parseInstalledUpscaleModels,
  recommendedUpscaleForArchitecture,
  upscaleCatalogByFilename
} from "./upscale-catalog.js";

describe("upscale catalog", () => {
  it("covers four curated models with clear use cases", () => {
    expect(UPSCALE_CATALOG.map(e => e.filename)).toEqual([
      "RealESRGAN_x4plus.pth",
      "4x-UltraSharp.pth",
      "RealESRGAN_x4plus_anime_6B.pth",
      "remacri_original.safetensors"
    ]);
    for (const entry of UPSCALE_CATALOG) {
      expect(entry.useCase.length).toBeGreaterThan(40);
      expect(entry.optionLabel.length).toBeGreaterThan(10);
      expect(entry.recommendedFor.length).toBeGreaterThan(0);
      expect(["photo", "sharp", "illustration", "anime"]).toContain(entry.style);
    }
  });

  it("recommends photo vs anime defaults by architecture", () => {
    expect(recommendedUpscaleForArchitecture("z-image")).toBe(DEFAULT_UPSCALE_MODEL);
    expect(recommendedUpscaleForArchitecture("krea2")).toBe(DEFAULT_UPSCALE_MODEL);
    expect(recommendedUpscaleForArchitecture("illustrious")).toBe("RealESRGAN_x4plus_anime_6B.pth");
    expect(recommendedUpscaleForArchitecture("anima")).toBe("RealESRGAN_x4plus_anime_6B.pth");
  });

  it("falls back when preferred model is not installed", () => {
    expect(
      recommendedUpscaleForArchitecture("anima", ["remacri_original.safetensors", DEFAULT_UPSCALE_MODEL])
    ).toBe("remacri_original.safetensors");
    expect(recommendedUpscaleForArchitecture("z-image", ["4x-UltraSharp.pth"])).toBe("4x-UltraSharp.pth");
  });

  it("parses Comfy COMBO layouts and marks install status", () => {
    const info = {
      UpscaleModelLoader: {
        input: {
          required: {
            model_name: ["COMBO", { options: ["RealESRGAN_x4plus.pth", "4x-UltraSharp.pth"] }]
          }
        }
      }
    };
    expect(parseInstalledUpscaleModels(info)).toEqual(["RealESRGAN_x4plus.pth", "4x-UltraSharp.pth"]);
    const listed = listUpscaleCatalog(parseInstalledUpscaleModels(info));
    expect(listed.find(x => x.filename === "RealESRGAN_x4plus.pth")?.installed).toBe(true);
    expect(listed.find(x => x.filename === "remacri_original.safetensors")?.installed).toBe(false);
  });

  it("looks up catalog entries by filename", () => {
    expect(upscaleCatalogByFilename("remacri_original.safetensors")?.style).toBe("illustration");
    expect(upscaleCatalogByFilename("missing.pth")).toBeUndefined();
  });
});
