import { describe, expect, it } from "vitest";
import { composeCharacterPrompts, type GenerationCharacter } from "./prompt-composition.js";

const character = (id: string, prompt: string, negative = ""): GenerationCharacter => ({
  id, prompt, negative, references: []
});

describe("multi-character prompt composition", () => {
  it("preserves add order and deduplicates shared prompt and negative segments", () => {
    const result = composeCharacterPrompts(
      "studio gym, cinematic light",
      "blurry, watermark",
      [
        character("00000000-0000-4000-8000-000000000001", "adult woman, red hair, cinematic light", "bad hands"),
        character("00000000-0000-4000-8000-000000000002", "adult man, blue shirt, studio gym", "watermark")
      ]
    );
    expect(result.positive).toBe("Global scene: studio gym, cinematic light. Character 1: adult woman, red hair. Character 2: adult man, blue shirt");
    expect(result.negative).toBe("blurry, watermark, bad hands");
  });

  it("relabels cleanly after a character is removed", () => {
    const remaining = [character("00000000-0000-4000-8000-000000000002", "adult man")];
    expect(composeCharacterPrompts("arena", "", remaining).positive)
      .toBe("Global scene: arena. Character 1: adult man");
  });
});
