export type GenerationMedia = {
  filename: string;
  subfolder?: string;
  type?: string;
};

export type GenerationOutcome =
  | { status: "completed"; images: GenerationMedia[]; videos: GenerationMedia[] }
  | { status: "failed"; error: string };

/** After this age, a job with no Comfy queue entry and no terminal history is treated as orphaned. */
export const ORPHAN_JOB_MS = 90_000;

export const ORPHAN_JOB_ERROR =
  "This job is no longer in ComfyUI (queue empty and history missing). Cleared as a stuck pending record — model files were not changed.";

export const DISMISS_JOB_ERROR =
  "Cleared from Activity by user. ComfyUI was interrupted/cancelled when possible; model files were not changed.";

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

/** Collect prompt ids from Comfy `/queue` running + pending entries. */
export function promptIdsInComfyQueue(queue: any): Set<string> {
  const ids = new Set<string>();
  const take = (list: unknown) => {
    if (!Array.isArray(list)) return;
    for (const item of list) {
      // Comfy format: [number, prompt_id, prompt, extra_data, outputs_to_execute]
      const id = Array.isArray(item) ? item[1] : (item as any)?.prompt_id;
      if (id) ids.add(String(id));
    }
  };
  take(queue?.queue_running);
  take(queue?.queue_pending);
  return ids;
}

export function recordAgeMs(record: any, now = Date.now()): number {
  const started = Number(record?.started);
  if (Number.isFinite(started) && started > 0) return Math.max(0, now - started);
  const created = Date.parse(String(record?.createdAt || ""));
  if (Number.isFinite(created)) return Math.max(0, now - created);
  return 0;
}

/**
 * A Studio job is an orphan when it is still pending/active, Comfy no longer has it
 * in the queue, history has no terminal outcome, and it has aged past ORPHAN_JOB_MS.
 * Does not invent completions — only safe failure for ghosts.
 */
export function orphanGenerationOutcome(
  record: any,
  options: {
    historyHasTerminal: boolean;
    inComfyQueue: boolean;
    now?: number;
    orphanAfterMs?: number;
  }
): GenerationOutcome | undefined {
  if (!["pending", "active"].includes(String(record?.status))) return undefined;
  if (options.historyHasTerminal || options.inComfyQueue) return undefined;
  const age = recordAgeMs(record, options.now ?? Date.now());
  const threshold = options.orphanAfterMs ?? ORPHAN_JOB_MS;
  if (age < threshold) return undefined;
  return { status: "failed", error: ORPHAN_JOB_ERROR };
}
