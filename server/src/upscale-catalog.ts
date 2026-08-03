/**
 * Curated neural upscalers for the shared post-decode finishing stage.
 * All models run in pixel space via UpscaleModelLoader → ImageUpscaleWithModel →
 * Lanczos ImageScale back to the exact canvas, so every Photo architecture
 * (z-image, krea2, illustrious, anima) can use any installed entry.
 *
 * Prefer installing under `upscale_models/` (project) or ComfyUI's
 * `models/upscale_models/` — both are discovered through extra_model_paths.
 */

export type PhotoArchitecture = "z-image" | "krea2" | "illustrious" | "anima";

export type UpscaleCatalogEntry = {
  /** Filename ComfyUI UpscaleModelLoader expects */
  filename: string;
  /** Short UI label */
  label: string;
  /** One-line use case shown under the selector */
  useCase: string;
  /** Compact option text (select <option> label) */
  optionLabel: string;
  /** Architectures this model is a strong default for (still works on all) */
  recommendedFor: PhotoArchitecture[];
  /** Style bucket for sorting / docs */
  style: "photo" | "sharp" | "illustration" | "anime";
  /** SPDX or plain license note for the UI */
  license: string;
  /** Sort order in the UI (lower first) */
  order: number;
};

export const DEFAULT_UPSCALE_MODEL = "RealESRGAN_x4plus.pth";

export const UPSCALE_CATALOG: UpscaleCatalogEntry[] = [
  {
    filename: "RealESRGAN_x4plus.pth",
    label: "Real-ESRGAN x4 Plus",
    useCase:
      "Default for photoreal portraits and products. Balanced detail with mild cleanup. Best everyday pick for Z-Image and Krea 2.",
    optionLabel: "Real-ESRGAN x4 Plus — photo / product (default)",
    recommendedFor: ["z-image", "krea2"],
    style: "photo",
    license: "BSD-3-Clause",
    order: 10
  },
  {
    filename: "4x-UltraSharp.pth",
    label: "4x UltraSharp",
    useCase:
      "Extra edge and micro-texture for product shots, fabrics, and crisp stills. Can over-sharpen soft faces — prefer Real-ESRGAN for gentle portraits.",
    optionLabel: "4x UltraSharp — sharp product / texture",
    recommendedFor: ["z-image", "krea2"],
    style: "sharp",
    license: "CC-BY-NC-SA-4.0 (noncommercial)",
    order: 20
  },
  {
    filename: "RealESRGAN_x4plus_anime_6B.pth",
    label: "Real-ESRGAN Anime 6B",
    useCase:
      "Official anime/illustration upscaler. Clean flat color and cel lines without photo-style grain. Best default for Anima and Illustrious.",
    optionLabel: "Real-ESRGAN Anime 6B — anime / cel (Illustrious, Anima)",
    recommendedFor: ["illustrious", "anima"],
    style: "anime",
    license: "BSD-3-Clause",
    order: 30
  },
  {
    filename: "remacri_original.safetensors",
    label: "Remacri x4",
    useCase:
      "Illustration-leaning polish: line clarity and painted texture. Strong on Illustrious/Anima art styles; less natural on pure photography. Noncommercial license.",
    optionLabel: "Remacri x4 — illustration texture (noncommercial)",
    recommendedFor: ["illustrious", "anima"],
    style: "illustration",
    license: "CC-BY-NC-SA-4.0 (noncommercial)",
    order: 40
  }
];

export function upscaleCatalogByFilename(filename: string): UpscaleCatalogEntry | undefined {
  return UPSCALE_CATALOG.find(entry => entry.filename === filename);
}

/** Preferred default when the user enables neural upscale for a given architecture. */
export function recommendedUpscaleForArchitecture(
  architecture?: string | null,
  installed: string[] = []
): string {
  const prefer =
    architecture === "illustrious" || architecture === "anima"
      ? ["RealESRGAN_x4plus_anime_6B.pth", "remacri_original.safetensors", DEFAULT_UPSCALE_MODEL]
      : [DEFAULT_UPSCALE_MODEL, "4x-UltraSharp.pth", "remacri_original.safetensors"];
  if (!installed.length) return prefer[0];
  return prefer.find(name => installed.includes(name)) || installed[0] || DEFAULT_UPSCALE_MODEL;
}

export function listUpscaleCatalog(installed: string[] = []): Array<UpscaleCatalogEntry & { installed: boolean }> {
  const set = new Set(installed);
  return [...UPSCALE_CATALOG]
    .sort((a, b) => a.order - b.order)
    .map(entry => ({ ...entry, installed: set.size === 0 ? true : set.has(entry.filename) }));
}

/** Extract model filenames from ComfyUI object_info UpscaleModelLoader combo. */
export function parseInstalledUpscaleModels(info: Record<string, any> | null | undefined): string[] {
  const input = info?.UpscaleModelLoader?.input?.required?.model_name;
  if (Array.isArray(input?.[1]?.options)) return input[1].options as string[];
  if (Array.isArray(input?.[0])) return input[0] as string[];
  return [];
}
