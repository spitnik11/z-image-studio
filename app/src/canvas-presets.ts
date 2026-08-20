/**
 * Photo Output canvas presets + size limits.
 * Keep in sync with server/src/canvas-size.ts (limits + preset list).
 *
 * Defaults unchanged: Photo still opens at 1024×1024.
 * New presets are additive only.
 */
export const CANVAS_MIN_EDGE = 256;
/** Max edge for Photo generate / custom size (QHD 2560×1440). */
export const CANVAS_MAX_EDGE = 2560;

export type PhotoCanvasPreset = {
  id: string;
  /** Short button label under the aspect thumbnail. */
  label: string;
  width: number;
  height: number;
};

/**
 * Order matches the Output section grid (3 columns × 2 rows).
 * Existing presets first; QHD is the hi-res 16:9 option after Cinema.
 */
export const PHOTO_CANVAS_PRESETS: readonly PhotoCanvasPreset[] = [
  { id: "square", label: "Square", width: 1024, height: 1024 },
  { id: "portrait-9-16", label: "Portrait 9:16", width: 1080, height: 1920 },
  { id: "portrait-3-4", label: "Portrait 3:4", width: 1530, height: 2048 },
  { id: "landscape", label: "Landscape", width: 1536, height: 1024 },
  { id: "cinema-16-9", label: "Cinema 16:9", width: 1920, height: 1080 },
  { id: "qhd-16-9", label: "QHD 16:9", width: 2560, height: 1440 }
] as const;

export function isCanvasEdgeInRange(value: number): boolean {
  return Number.isFinite(value) && value >= CANVAS_MIN_EDGE && value <= CANVAS_MAX_EDGE;
}
