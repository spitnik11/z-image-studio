export type GenerationMedia = {
  filename: string;
  subfolder?: string;
  type?: string;
};

export type GenerationOutcome =
  | { status: "completed"; images: GenerationMedia[]; videos: GenerationMedia[] }
  | { status: "failed"; error: string };

function historyError(item: any) {
  const messages = Array.isArray(item?.status?.messages) ? item.status.messages : [];
  const failure = messages.find((message: any) => message?.[0] === "execution_error");
  return failure?.[1]?.exception_message || failure?.[1]?.exception_type || "ComfyUI execution failed";
}

export function generationOutcome(history: any, promptId: string): GenerationOutcome | undefined {
  const item = history?.[promptId];
  if (!item) return undefined;
  const status = String(item.status?.status_str || "").toLowerCase();
  if (status === "error" || status === "failed") return { status: "failed", error: historyError(item) };
  if (item.status?.completed !== true && status !== "success") return undefined;

  const outputMedia = Object.values(item.outputs || {}).flatMap((output: any) => {
    if (Array.isArray(output?.videos)) return output.videos;
    if (Array.isArray(output?.video)) return output.video;
    if (output?.video?.filename) return [output.video];
    return Array.isArray(output?.images) ? output.images : [];
  }) as GenerationMedia[];
  const videos = outputMedia.filter(media => /\.(mp4|mov|webm|mkv)$/i.test(String(media?.filename || "")));
  const images = outputMedia.filter(media => !/\.(mp4|mov|webm|mkv)$/i.test(String(media?.filename || "")));
  return { status: "completed", images, videos };
}

export function persistedGenerationOutcome(record: any): GenerationOutcome | undefined {
  if (!["pending", "active"].includes(String(record?.status))) return undefined;
  const images = Array.isArray(record?.images) ? record.images.filter((media: any) => media?.filename) : [];
  const videos = Array.isArray(record?.videos) ? record.videos.filter((media: any) => media?.filename) : [];
  const terminalEvidence = Number(record?.progress) >= 100 || Number(record?.durationMs) > 0;
  if (!terminalEvidence || (!images.length && !videos.length)) return undefined;
  return { status: "completed", images, videos };
}
