import { describe, expect, it } from "vitest";
import {
  composeStyleMaintainReferences,
  recommendedStyleMaintainStrengths,
  styleMaintainUsesCharacterConsistency
} from "./style-maintain.js";

describe("style maintain helpers", () => {
  it("recommends stronger look lock on Krea than Illustrious", () => {
    expect(recommendedStyleMaintainStrengths("krea2").look).toBeGreaterThan(
      recommendedStyleMaintainStrengths("illustrious").look
    );
  });

  it("enables Character Consistency only for z-image and krea2", () => {
    expect(styleMaintainUsesCharacterConsistency("krea2")).toBe(true);
    expect(styleMaintainUsesCharacterConsistency("z-image")).toBe(true);
    expect(styleMaintainUsesCharacterConsistency("illustrious")).toBe(false);
    expect(styleMaintainUsesCharacterConsistency("anima")).toBe(false);
  });

  it("composes look-only Direct reference", () => {
    expect(
      composeStyleMaintainReferences({
        architecture: "krea2",
        look: { image: "z-image-studio/look.png" }
      })
    ).toEqual([{ image: "z-image-studio/look.png", mode: "direct", strength: 0.78 }]);
  });

  it("composes look Direct + pose with architecture defaults", () => {
    expect(
      composeStyleMaintainReferences({
        architecture: "illustrious",
        look: { image: "look.png" },
        pose: { image: "pose.png" }
      })
    ).toEqual([
      { image: "look.png", mode: "direct", strength: 0.6 },
      { image: "pose.png", mode: "pose", strength: 0.95 }
    ]);
  });

  it("honors explicit strengths and clamps", () => {
    const refs = composeStyleMaintainReferences({
      architecture: "z-image",
      look: { image: "a.png", strength: 9 },
      pose: { image: "b.png", strength: 0 }
    });
    expect(refs[0].strength).toBe(2);
    expect(refs[1].strength).toBe(0.05);
  });
});
