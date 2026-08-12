/**
 * Shared Photo / Dataset canvas size limits.
 *
 * Modular: raise CANVAS_MAX_EDGE once; generation schema, settings defaults,
 * and dataset schema all import these constants.
 * Backwards compatible: min stays 256; default Photo size stays 1024×1024;
 * existing presets under 2048 remain valid.
 */
export const CANVAS_MIN_EDGE = 256;
/** Supports QHD 2560×1440 (16:9). Was 2048 before 2026-08-11. */
export const CANVAS_MAX_EDGE = 2560;
/** Default Photo canvas (unchanged). */
export const CANVAS_DEFAULT_WIDTH = 1024;
export const CANVAS_DEFAULT_HEIGHT = 1024;

/** Known Photo output presets (UI mirrors this order). */
export const PHOTO_CANVAS_PRESETS = [
  { id: "square", label: "Square", width: 1024, height: 1024 },
  { id: "portrait-9-16", label: "Portrait 9:16", width: 1080, height: 1920 },
  { id: "portrait-3-4", label: "Portrait 3:4", width: 1530, height: 2048 },
  { id: "landscape", label: "Landscape", width: 1536, height: 1024 },
  { id: "cinema-16-9", label: "Cinema 16:9", width: 1920, height: 1080 },
  { id: "qhd-16-9", label: "QHD 16:9", width: 2560, height: 1440 }
] as const;

export type PhotoCanvasPreset = (typeof PHOTO_CANVAS_PRESETS)[number];

export function isCanvasEdgeInRange(value: number): boolean {
  return Number.isInteger(value) && value >= CANVAS_MIN_EDGE && value <= CANVAS_MAX_EDGE;
}
