/**
 * Client-side mirror of server/src/upscale-catalog.ts for UI labels.
 * Keep filenames and use-case copy in sync when adding models.
 */

export type PhotoArchitecture = "z-image" | "krea2" | "illustrious" | "anima";

export type UpscaleCatalogEntry = {
  filename: string;
  label: string;
  useCase: string;
  optionLabel: string;
  recommendedFor: PhotoArchitecture[];
  style: "photo" | "sharp" | "illustration" | "anime";
  license: string;
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

export function recommendedUpscaleForArchitecture(architecture?: string | null): string {
  if (architecture === "illustrious" || architecture === "anima") {
    return "RealESRGAN_x4plus_anime_6B.pth";
  }
  return DEFAULT_UPSCALE_MODEL;
}

export function isUpscaleRecommended(filename: string, architecture?: string | null): boolean {
  if (!architecture) return false;
  const entry = upscaleCatalogByFilename(filename);
  return Boolean(entry?.recommendedFor.includes(architecture as PhotoArchitecture));
}
