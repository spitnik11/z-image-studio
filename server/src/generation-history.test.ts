import { describe, expect, it } from "vitest";
import {
  generationOutcome,
  orphanGenerationOutcome,
  ORPHAN_JOB_MS,
  persistedGenerationOutcome,
  promptIdsInComfyQueue,
  recordAgeMs
} from "./generation-history.js";

describe("generation history reconciliation", () => {
  it("recovers an instant cached image completion", () => {
    const history = {
      prompt: {
        outputs: { "10": { images: [{ filename: "cached.png", subfolder: "", type: "output" }] } },
        status: { status_str: "success", completed: true, messages: [["execution_cached", {}], ["execution_success", {}]] }
      }
    };
    expect(generationOutcome(history, "prompt")).toEqual({
      status: "completed",
      images: [{ filename: "cached.png", subfolder: "", type: "output" }],
      videos: []
    });
  });

  it("recovers a terminal ComfyUI error", () => {
    const history = {
      prompt: {
        outputs: {},
        status: {
          status_str: "error",
          completed: false,
          messages: [["execution_error", { exception_message: "LoRA key mismatch" }]]
        }
      }
    };
    expect(generationOutcome(history, "prompt")).toEqual({ status: "failed", error: "LoRA key mismatch" });
  });

  it("leaves non-terminal or unknown prompts alone", () => {
    expect(generationOutcome({}, "missing")).toBeUndefined();
    expect(generationOutcome({ prompt: { status: { status_str: "running", completed: false } } }, "prompt")).toBeUndefined();
  });

  it("recovers persisted output when ComfyUI history was cleared by a restart", () => {
    expect(persistedGenerationOutcome({
      status: "active",
      progress: 100,
      durationMs: 24_668,
      images: [{ filename: "finished.png", subfolder: "", type: "output" }]
    })).toEqual({
      status: "completed",
      images: [{ filename: "finished.png", subfolder: "", type: "output" }],
      videos: []
    });
    expect(persistedGenerationOutcome({ status: "active", progress: 99, images: [{ filename: "partial.png" }] })).toBeUndefined();
    expect(persistedGenerationOutcome({ status: "active", progress: 100, images: [] })).toBeUndefined();
    // A recorded duration is sufficient terminal evidence even without a persisted progress of 100.
    expect(persistedGenerationOutcome({ status: "pending", durationMs: 5_000, videos: [{ filename: "clip.mp4" }] }))
      .toEqual({ status: "completed", images: [], videos: [{ filename: "clip.mp4" }] });
    // An already-terminal record is never re-derived from persisted media (no false regression/duplication).
    expect(persistedGenerationOutcome({ status: "completed", progress: 100, images: [{ filename: "done.png" }] })).toBeUndefined();
    expect(persistedGenerationOutcome({ status: "failed", durationMs: 5_000, images: [{ filename: "done.png" }] })).toBeUndefined();
  });

  it("detects prompt ids in the Comfy queue shape", () => {
    const ids = promptIdsInComfyQueue({
      queue_running: [[0, "run-1", {}, {}, []]],
      queue_pending: [[1, "pend-2", {}, {}, []]]
    });
    expect([...ids].sort()).toEqual(["pend-2", "run-1"]);
    expect(promptIdsInComfyQueue({ queue_running: [], queue_pending: [] }).size).toBe(0);
  });

  it("fails orphaned pending jobs only after age threshold with empty queue and no history", () => {
    const now = 1_000_000;
    const young = { status: "pending", started: now - 10_000, promptId: "ghost" };
    const old = { status: "pending", started: now - ORPHAN_JOB_MS - 1, promptId: "ghost" };
    expect(recordAgeMs(old, now)).toBeGreaterThanOrEqual(ORPHAN_JOB_MS);
    expect(orphanGenerationOutcome(young, { historyHasTerminal: false, inComfyQueue: false, now })).toBeUndefined();
    expect(orphanGenerationOutcome(old, { historyHasTerminal: false, inComfyQueue: true, now })).toBeUndefined();
    expect(orphanGenerationOutcome(old, { historyHasTerminal: true, inComfyQueue: false, now })).toBeUndefined();
    expect(orphanGenerationOutcome(old, { historyHasTerminal: false, inComfyQueue: false, now })).toMatchObject({
      status: "failed",
      error: expect.stringMatching(/no longer in ComfyUI/i)
    });
    expect(orphanGenerationOutcome({ status: "completed", started: now - ORPHAN_JOB_MS * 2 }, {
      historyHasTerminal: false, inComfyQueue: false, now
    })).toBeUndefined();
  });
});
