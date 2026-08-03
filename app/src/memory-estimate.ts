export type MemoryEstimateInput = {
  architecture?: "z-image" | "krea2" | "illustrious" | "anima" | "unknown";
  width: number;
  height: number;
  quantity: number;
  loraCount: number;
  neuralUpscale: boolean;
  faceRefinement: boolean;
};

export function estimatePhotoVram(input: MemoryEstimateInput) {
  const baseGb = input.architecture === "krea2" ? 8.5
    : input.architecture === "illustrious" ? 6.5
      : 7.5;
  const megapixels = Math.max(0, input.width * input.height) / 1_000_000;
  const activationGb = megapixels * Math.max(1, input.quantity) * 1.15;
  const adapterGb = Math.max(0, input.loraCount) * 0.25;
  const finishingGb = (input.neuralUpscale ? 0.8 : 0) + (input.faceRefinement ? 1.2 : 0);
  const estimatedGb = Math.round((baseGb + activationGb + adapterGb + finishingGb) * 10) / 10;
  return {
    estimatedGb,
    high: estimatedGb >= 11,
    label: `Estimated peak working set: about ${estimatedGb.toFixed(1)} GB`
  };
}
