/** Client-side Style Maintain helpers (mirrors server/src/style-maintain.ts). */

export type StyleMaintainArchitecture = "z-image" | "krea2" | "illustrious" | "anima" | "unknown";

export type StyleMaintainStrengths = { look: number; pose: number };

export function recommendedStyleMaintainStrengths(
  architecture: StyleMaintainArchitecture
): StyleMaintainStrengths {
  switch (architecture) {
    case "krea2":
      return { look: 0.78, pose: 0.9 };
    case "z-image":
      return { look: 0.62, pose: 0.9 };
    case "illustrious":
      return { look: 0.6, pose: 0.95 };
    case "anima":
      return { look: 0.6, pose: 0.95 };
    default:
      return { look: 0.65, pose: 0.9 };
  }
}

export function styleMaintainUsesCharacterConsistency(
  architecture: StyleMaintainArchitecture
): boolean {
  return architecture === "z-image" || architecture === "krea2";
}

export function styleMaintainGuidance(architecture: StyleMaintainArchitecture): string {
  switch (architecture) {
    case "krea2":
      return "Krea Identity Edit holds look best. Add a Pose reference (or describe the new pose in the prompt). Keep look strength moderate so pose can win.";
    case "z-image":
      return "Z-Image look lock is approximate (structure + optional face polish). Prefer a face/character LoRA. Use a Pose reference for body placement.";
    case "illustrious":
      return "Illustrious uses OpenPose + Canny. Character Consistency is unavailable — rely on Direct + Pose refs and a character LoRA for identity.";
    case "anima":
      return "Anima uses LLLite pose/lineart. Prefer a character LoRA for identity; Pose reference drives body.";
    default:
      return "Upload a Look image and optionally a Pose image, then rewrite the prompt for the new pose/camera/scene.";
  }
}
