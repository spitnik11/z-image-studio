/**
 * Style Maintain helpers — compose Look (Direct/Identity) + optional Pose refs
 * so Photo can keep character appearance while changing pose.
 * Default-off feature: callers only use this when the user enables Style Maintain.
 */

export type StyleMaintainArchitecture = "z-image" | "krea2" | "illustrious" | "anima" | "unknown";

export type StyleMaintainStrengths = {
  /** Direct / Identity / Structure look lock */
  look: number;
  /** Pose ControlNet / OpenPose / depth */
  pose: number;
};

/** Architecture-aware starting strengths (mirrors Dataset identity heuristics). */
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

/** Z-Image / Krea support Character Consistency (Direct master + optional Pose). */
export function styleMaintainUsesCharacterConsistency(
  architecture: StyleMaintainArchitecture
): boolean {
  return architecture === "z-image" || architecture === "krea2";
}

export type StyleMaintainRefInput = {
  image: string;
  strength?: number;
};

export type ComposedStyleMaintainReference = {
  image: string;
  mode: "direct" | "pose";
  strength: number;
};

/**
 * Build the reference list for a Style Maintain generate.
 * Look is always Direct. Pose is optional.
 */
export function composeStyleMaintainReferences(input: {
  architecture: StyleMaintainArchitecture;
  look: StyleMaintainRefInput;
  pose?: StyleMaintainRefInput | null;
  strengths?: Partial<StyleMaintainStrengths>;
}): ComposedStyleMaintainReference[] {
  const defaults = recommendedStyleMaintainStrengths(input.architecture);
  const lookStrength = clampStrength(input.look.strength ?? input.strengths?.look ?? defaults.look);
  const refs: ComposedStyleMaintainReference[] = [
    { image: input.look.image, mode: "direct", strength: lookStrength }
  ];
  if (input.pose?.image) {
    const poseStrength = clampStrength(input.pose.strength ?? input.strengths?.pose ?? defaults.pose);
    refs.push({ image: input.pose.image, mode: "pose", strength: poseStrength });
  }
  return refs;
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

function clampStrength(value: number): number {
  if (!Number.isFinite(value)) return 0.7;
  return Math.min(2, Math.max(0.05, Math.round(value * 100) / 100));
}
