import { z } from "zod";

export const generationCharacterSchema = z.object({
  id: z.string().uuid(),
  prompt: z.string().trim().min(1).max(2000),
  negative: z.string().trim().max(1000).default("")
});

export type GenerationCharacter = z.infer<typeof generationCharacterSchema> & {
  references: Array<{ image: string; mode: "pose" | "direct" | "face"; strength: number }>;
};

function uniqueCommaSegments(text: string, seen: Set<string>) {
  return text.split(",").map(item => item.trim()).filter(item => {
    if (!item) return false;
    const key = item.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ponytail: concatenated character prompts can still bleed attributes between subjects.
// True separation requires regional/attention-couple conditioning in phase 2.
export function composeCharacterPrompts(globalPrompt: string, globalNegative: string, characters: GenerationCharacter[]) {
  const positiveSeen = new Set<string>();
  const negativeSeen = new Set<string>();
  const globalPositive = uniqueCommaSegments(globalPrompt, positiveSeen).join(", ");
  const positiveBlocks = [
    globalPositive && `Global scene: ${globalPositive}`,
    ...characters.map((character, index) => {
      const prompt = uniqueCommaSegments(character.prompt, positiveSeen).join(", ");
      return prompt ? `Character ${index + 1}: ${prompt}` : "";
    })
  ].filter(Boolean);
  const negative = [
    ...uniqueCommaSegments(globalNegative, negativeSeen),
    ...characters.flatMap(character => uniqueCommaSegments(character.negative, negativeSeen))
  ].join(", ");
  return { positive: positiveBlocks.join(". "), negative };
}
