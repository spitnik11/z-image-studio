import { describe, expect, it } from "vitest";
import { parseTrainingProgress } from "./training-telemetry.js";

describe("training telemetry", () => {
  it("parses the latest Musubi progress line and ETA", () => {
    const result = parseTrainingProgress([
      "steps:  4%| | 36/800 [2:20:41<49:45:40, 234.48s/it, avr_loss=0.0504]",
      "steps:  5%| | 37/800 [2:23:24<49:17:28, 232.57s/it, avr_loss=0.0489]"
    ].join("\n"), 800);
    expect(result).toMatchObject({
      currentStep: 37,
      totalSteps: 800,
      elapsedSeconds: 8604,
      etaSeconds: 177448,
      secondsPerIteration: 232.57,
      percent: 5
    });
  });

  it("returns null while the trainer is still initializing", () => {
    expect(parseTrainingProgress("Loading raw.safetensors: 89%")).toBeNull();
  });
});
