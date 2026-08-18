import { describe, expect, it } from "vitest";
import {
  applyTransparentAssetPostProcess,
  LAYERSTYLE_TRANSPARENT_NODE,
  TRANSPARENT_ASSET_NODE_ID
} from "./layerstyle-postprocess.js";
import type { ApiWorkflow } from "./workflow.js";

function baseFinishGraph(): ApiWorkflow {
  return {
    "9": { class_type: "VAEDecode", inputs: { samples: ["8", 0], vae: ["3", 0] } },
    "11": {
      class_type: "ImageScale",
      inputs: { image: ["9", 0], upscale_method: "lanczos", width: 512, height: 512, crop: "disabled" }
    },
    "10": { class_type: "SaveImage", inputs: { filename_prefix: "asset", images: ["11", 0] } }
  };
}

describe("layerstyle transparent asset post-process", () => {
  it("does nothing unless applyTransparentAssetPostProcess is called", () => {
    const workflow = baseFinishGraph();
    expect(workflow[TRANSPARENT_ASSET_NODE_ID]).toBeUndefined();
    expect(workflow["10"].inputs.images).toEqual(["11", 0]);
  });

  it("inserts RmBgUltra V2 after exact canvas and rewires SaveImage", () => {
    const workflow = baseFinishGraph();
    const ref = applyTransparentAssetPostProcess(workflow, { image: ["11", 0] });
    expect(ref).toEqual([TRANSPARENT_ASSET_NODE_ID, 0]);
    expect(workflow[TRANSPARENT_ASSET_NODE_ID]?.class_type).toBe(LAYERSTYLE_TRANSPARENT_NODE);
    expect(workflow[TRANSPARENT_ASSET_NODE_ID]?.inputs.image).toEqual(["11", 0]);
    expect(workflow[TRANSPARENT_ASSET_NODE_ID]?.inputs.detail_method).toBe("GuidedFilter");
    expect(workflow["10"].class_type).toBe("SaveImage");
    expect(workflow["10"].inputs.images).toEqual([TRANSPARENT_ASSET_NODE_ID, 0]);
  });

  it("coerces SaveAnimatedWEBP to SaveImage for transparent assets", () => {
    const workflow = baseFinishGraph();
    workflow["10"] = {
      class_type: "SaveAnimatedWEBP",
      inputs: { images: ["11", 0], filename_prefix: "asset", fps: 1, lossless: false, quality: 90, method: "default" }
    };
    applyTransparentAssetPostProcess(workflow, { image: ["11", 0] });
    expect(workflow["10"].class_type).toBe("SaveImage");
    expect(workflow["10"].inputs.images).toEqual([TRANSPARENT_ASSET_NODE_ID, 0]);
    expect(workflow["10"].inputs.filename_prefix).toBe("asset");
  });
});
