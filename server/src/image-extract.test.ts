import { describe, expect, it } from "vitest";
import {
  buildPoseExtractWorkflow,
  buildPromptExtractWorkflow,
  detectExtractCapabilities,
  florenceTaskForMode,
  preferredFlorenceVersion
} from "./image-extract.js";

describe("image extract workflows", () => {
  it("builds OpenPose stick-figure graph", () => {
    const w = buildPoseExtractWorkflow("z-image-studio/src.png", "extract-pose-test");
    expect(w["1"].class_type).toBe("LoadImage");
    expect(w["2"].class_type).toBe("OpenposePreprocessor");
    expect(w["3"].class_type).toBe("SaveImage");
    expect(w["3"].inputs.images).toEqual(["2", 0]);
  });

  it("builds Florence caption/tags graphs", () => {
    const caption = buildPromptExtractWorkflow("z-image-studio/src.png", "caption", "base-PromptGen-v2.0");
    expect(caption["2"].class_type).toBe("LayerMask: LoadFlorence2Model");
    expect(caption["3"].inputs.task).toBe(florenceTaskForMode("caption"));
    expect(caption["4"].class_type).toBe("SaveText");

    const tags = buildPromptExtractWorkflow("z-image-studio/src.png", "tags", "base-PromptGen-v2.0");
    expect(tags["3"].inputs.task).toBe(florenceTaskForMode("tags"));
  });

  it("prefers PromptGen Florence versions when listed", () => {
    expect(preferredFlorenceVersion(["base", "base-PromptGen-v2.0"])).toBe("base-PromptGen-v2.0");
    expect(preferredFlorenceVersion(["base"])).toBe("base");
  });

  it("detects missing extract nodes", () => {
    const caps = detectExtractCapabilities({
      LoadImage: {},
      OpenposePreprocessor: {},
      SaveImage: {}
    });
    expect(caps.pose).toBe(true);
    expect(caps.prompt).toBe(false);
    expect(caps.missingPrompt.length).toBeGreaterThan(0);
  });
});
