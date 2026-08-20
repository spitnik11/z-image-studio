/**
 * Optional LayerStyle post-process for transparent PNG assets / logos.
 * Default OFF everywhere — when disabled, callers must not invoke this helper,
 * so Photo graphs stay identical to the pre-LayerStyle finish path.
 *
 * Finish order (when enabled):
 *   ImageScale(11) → LayerMask: RmBgUltra V2 (310) → SaveImage(10)
 */

export type ApiWorkflow = Record<string, { class_type: string; inputs: Record<string, unknown>; _meta?: { title?: string } }>;

export const LAYERSTYLE_TRANSPARENT_NODE = "LayerMask: RmBgUltra V2";
export const LAYERSTYLE_TRANSPARENT_NODES = [LAYERSTYLE_TRANSPARENT_NODE] as const;

/** Node band after neural upscale (300–301). */
export const TRANSPARENT_ASSET_NODE_ID = "310";

export type TransparentDetailMethod =
  | "GuidedFilter"
  | "VITMatte"
  | "VITMatte(local)"
  | "PyMatting"
  | "vitmatte-base-composition-1k";

export type TransparentAssetOptions = {
  /** Image link after exact canvas scale, typically ["11", 0]. */
  image: [string, number];
  /** Prefer GuidedFilter so VitMatte weights are not required for the happy path. */
  detailMethod?: TransparentDetailMethod;
  processDetail?: boolean;
  device?: "cuda" | "cpu";
  detailErode?: number;
  detailDilate?: number;
  blackPoint?: number;
  whitePoint?: number;
  maxMegapixels?: number;
};

/**
 * Inserts RmBgUltra V2 after the exact canvas image and rewires SaveImage/WebP to its RGBA output.
 * Returns the new image reference for callers that need it.
 */
export function applyTransparentAssetPostProcess(
  workflow: ApiWorkflow,
  options: TransparentAssetOptions
): [string, number] {
  const detailMethod = options.detailMethod ?? "GuidedFilter";
  const processDetail = options.processDetail ?? true;
  const device = options.device ?? "cuda";

  workflow[TRANSPARENT_ASSET_NODE_ID] = {
    class_type: LAYERSTYLE_TRANSPARENT_NODE,
    inputs: {
      image: options.image,
      detail_method: detailMethod,
      detail_erode: options.detailErode ?? 6,
      detail_dilate: options.detailDilate ?? 6,
      black_point: options.blackPoint ?? 0.01,
      white_point: options.whitePoint ?? 0.99,
      process_detail: processDetail,
      device,
      max_megapixels: options.maxMegapixels ?? 2.0
    },
    _meta: { title: "[Post] Transparent asset (LayerStyle RmBgUltra V2)" }
  };

  const save = workflow["10"];
  if (save?.inputs) {
    // Transparent assets must be PNG — coerce WebP save to SaveImage.
    if (save.class_type !== "SaveImage") {
      const prefix = typeof save.inputs.filename_prefix === "string" ? save.inputs.filename_prefix : "z-image";
      workflow["10"] = {
        class_type: "SaveImage",
        inputs: { filename_prefix: prefix, images: [TRANSPARENT_ASSET_NODE_ID, 0] },
        _meta: { title: "[Output] Transparent PNG" }
      };
    } else {
      save.inputs.images = [TRANSPARENT_ASSET_NODE_ID, 0];
    }
  }

  return [TRANSPARENT_ASSET_NODE_ID, 0];
}
