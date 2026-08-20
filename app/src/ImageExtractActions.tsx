import React, { useEffect, useState } from "react";
import { PersonStanding, Sparkles } from "lucide-react";

export type ExtractCapabilities = {
  pose: boolean;
  prompt: boolean;
  florenceVersions?: string[];
  missingPose?: string[];
  missingPrompt?: string[];
};

type Source = {
  filename: string;
  subfolder?: string;
  type?: string;
} | null;

type Props = {
  source: Source;
  busy?: boolean;
  onNotice?: (message: string) => void;
  onPoseExtracted?: (payload: { image: string; filename: string; type: string }) => void;
  onPromptExtracted?: (prompt: string, mode: "caption" | "tags") => void;
};

export function ImageExtractActions({ source, busy, onNotice, onPoseExtracted, onPromptExtracted }: Props) {
  const [caps, setCaps] = useState<ExtractCapabilities | null>(null);
  const [working, setWorking] = useState<"pose" | "caption" | "tags" | null>(null);

  useEffect(() => {
    fetch("/api/extract/capabilities")
      .then(r => r.json())
      .then(setCaps)
      .catch(() => setCaps({ pose: false, prompt: false }));
  }, []);

  async function run(kind: "pose" | "caption" | "tags") {
    if (!source?.filename) {
      onNotice?.("Stage a base/look image first (Remix or Style Maintain).");
      return;
    }
    setWorking(kind);
    try {
      if (kind === "pose") {
        onNotice?.("Extracting pose stick figure…");
        const res = await fetch("/api/extract/pose", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            filename: source.filename,
            subfolder: source.subfolder || "",
            type: source.type || "input"
          })
        });
        const payload = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(payload.error || `Pose extract failed (${res.status})`);
        onPoseExtracted?.({
          image: String(payload.image),
          filename: String(payload.filename),
          type: String(payload.type || "input")
        });
        onNotice?.("Pose extracted — assigned as Pose reference. Adjust the prompt for the new pose if needed.");
      } else {
        onNotice?.(`Extracting ${kind === "tags" ? "tags" : "caption"} from image… (first Florence run may download weights)`);
        const res = await fetch("/api/extract/prompt", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            filename: source.filename,
            subfolder: source.subfolder || "",
            type: source.type || "input",
            mode: kind === "tags" ? "tags" : "caption"
          })
        });
        const payload = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(payload.error || `Prompt extract failed (${res.status})`);
        onPromptExtracted?.(String(payload.prompt || ""), kind === "tags" ? "tags" : "caption");
        onNotice?.(`Prompt extracted (${kind}). Edit freely, then Generate / Remix.`);
      }
    } catch (e: any) {
      onNotice?.(e.message || "Extract failed");
    } finally {
      setWorking(null);
    }
  }

  const disabled = busy || Boolean(working) || !source?.filename;

  return (
    <div className="image-extract-actions">
      <div className="image-extract-head">
        <strong>Extract from image</strong>
        <small>
          {caps
            ? `Pose ${caps.pose ? "ready" : "unavailable"} · Prompt ${caps.prompt ? "ready" : "unavailable"}`
            : "Checking Comfy extract nodes…"}
        </small>
      </div>
      <div className="image-extract-buttons">
        <button type="button" disabled={disabled || caps?.pose === false} onClick={() => run("pose")}>
          <PersonStanding size={14} /> {working === "pose" ? "Extracting pose…" : "Extract pose"}
        </button>
        <button type="button" disabled={disabled || caps?.prompt === false} onClick={() => run("caption")}>
          <Sparkles size={14} /> {working === "caption" ? "Extracting…" : "Extract caption"}
        </button>
        <button type="button" disabled={disabled || caps?.prompt === false} onClick={() => run("tags")}>
          <Sparkles size={14} /> {working === "tags" ? "Extracting…" : "Extract tags"}
        </button>
      </div>
      {!source?.filename && <small className="image-extract-hint">Needs a staged Remix base or Style Maintain Look image.</small>}
      {caps?.pose === false && <small className="image-extract-hint">OpenPose preprocessor missing in Comfy.</small>}
      {caps?.prompt === false && (
        <small className="image-extract-hint">Florence2 extract nodes missing (LayerStyle Advance).</small>
      )}
    </div>
  );
}
