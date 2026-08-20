import React, { useRef } from "react";
import { PersonStanding, Upload, X } from "lucide-react";
import type { PhotoReference, ReferenceCapability } from "./PhotoReferences";
import { ImageExtractActions } from "./ImageExtractActions";
import {
  recommendedStyleMaintainStrengths,
  styleMaintainGuidance,
  styleMaintainUsesCharacterConsistency,
  type StyleMaintainArchitecture
} from "./style-maintain";

export type StyleMaintainLookSource = {
  filename: string;
  subfolder?: string;
  type?: string;
  label: string;
};

type Props = {
  enabled: boolean;
  onEnabled: (next: boolean) => void;
  architecture?: StyleMaintainArchitecture;
  capabilities?: ReferenceCapability[];
  look: PhotoReference | null;
  pose: PhotoReference | null;
  onLook: (next: PhotoReference | null) => void;
  onPose: (next: PhotoReference | null) => void;
  busy?: boolean;
  onNotice?: (message: string) => void;
  onPromptExtracted?: (prompt: string, mode: "caption" | "tags") => void;
};

function previewUrl(ref: PhotoReference | null): string {
  if (!ref) return "";
  if (ref.file) return URL.createObjectURL(ref.file);
  if (ref.image) {
    const [path, query] = ref.image.includes("?") ? ref.image.split("?") : [ref.image, ""];
    if (ref.image.startsWith("/api/")) return ref.image;
    // Comfy input-relative path
    const parts = path.split("/");
    const filename = parts.pop() || path;
    const subfolder = parts.join("/");
    const params = new URLSearchParams({ filename, subfolder, type: "input" });
    return `/api/image?${params}${query ? `&${query}` : ""}`;
  }
  return "";
}

export function StyleMaintainPanel({
  enabled,
  onEnabled,
  architecture = "unknown",
  capabilities,
  look,
  pose,
  onLook,
  onPose,
  busy,
  onNotice,
  onPromptExtracted
}: Props) {
  const lookInput = useRef<HTMLInputElement>(null);
  const poseInput = useRef<HTMLInputElement>(null);
  const strengths = recommendedStyleMaintainStrengths(architecture);
  const poseCap = capabilities?.find(item => item.id === "pose");
  const lookCap = capabilities?.find(item =>
    architecture === "krea2" ? item.id === "identity" : item.id === "structure" || item.id === "face"
  );
  const consistency = styleMaintainUsesCharacterConsistency(architecture);
  const lookPreview = previewUrl(look);
  const posePreview = previewUrl(pose);

  function setLookFile(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    onLook({
      id: look?.id || crypto.randomUUID(),
      file,
      name: file.name,
      mode: "direct",
      strength: look?.strength ?? strengths.look
    });
    if (lookInput.current) lookInput.current.value = "";
  }

  function setPoseFile(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    onPose({
      id: pose?.id || crypto.randomUUID(),
      file,
      name: file.name,
      mode: "pose",
      strength: pose?.strength ?? strengths.pose
    });
    if (poseInput.current) poseInput.current.value = "";
  }

  return (
    <section className={`style-maintain-panel ${enabled ? "active" : ""}`}>
      <div className="section-title">
        <span><PersonStanding size={16} /> Style Maintain</span>
        <small>Keep look · change pose</small>
      </div>
      <label className="style-maintain-toggle">
        <input
          type="checkbox"
          checked={enabled}
          disabled={busy}
          onChange={event => onEnabled(event.target.checked)}
        />
        <span>
          <strong>Enable Style Maintain</strong>
          <small>
            {enabled
              ? "On: Look image locks appearance; Pose image and/or prompt drive a new pose. Separate from Improve (which preserves pose)."
              : "Off (default). Turn on to rewrite pose while keeping character look — NovelAI-style character reuse with explicit pose control."}
          </small>
        </span>
      </label>

      {enabled && (
        <>
          <p className="style-maintain-blurb">{styleMaintainGuidance(architecture)}</p>
          <div className="style-maintain-caps" aria-label="Style Maintain capability">
            <span className={lookCap?.available === false ? "unavailable" : "available"}>
              {lookCap?.available === false ? "—" : "✓"} Look path
            </span>
            <span className={poseCap?.available === false ? "unavailable" : "available"} title={poseCap?.message}>
              {poseCap?.available === false ? "—" : "✓"} Pose path
            </span>
            <span className={consistency ? "available" : "unavailable"}>
              {consistency ? "✓ Consistency" : "— Consistency (use Direct+Pose)"}
            </span>
          </div>

          <div className="style-maintain-slots">
            <div className="style-maintain-slot">
              <div className="style-maintain-slot-head">
                <strong>Look</strong>
                <small>Direct / Identity · {look?.strength ?? strengths.look}</small>
              </div>
              {lookPreview ? (
                <div className="style-maintain-preview">
                  <img src={lookPreview} alt={look?.name || "Look reference"} />
                  <button type="button" className="ghost" onClick={() => onLook(null)} aria-label="Clear look">
                    <X size={14} />
                  </button>
                </div>
              ) : (
                <button type="button" className="style-maintain-upload" onClick={() => lookInput.current?.click()} disabled={busy}>
                  <Upload size={14} /> Upload look image
                </button>
              )}
              <input ref={lookInput} type="file" accept="image/*" hidden onChange={e => setLookFile(e.target.files)} />
              {look && (
                <label>
                  Look strength
                  <input
                    type="range"
                    min={0.2}
                    max={1.2}
                    step={0.01}
                    value={look.strength}
                    onChange={e => onLook({ ...look, strength: +e.target.value })}
                  />
                </label>
              )}
            </div>

            <div className="style-maintain-slot">
              <div className="style-maintain-slot-head">
                <strong>Pose</strong>
                <small>Optional · {pose?.strength ?? strengths.pose}</small>
              </div>
              {poseCap?.available === false ? (
                <p className="style-maintain-warn">{poseCap.message || "Pose guidance unavailable for this model."}</p>
              ) : posePreview ? (
                <div className="style-maintain-preview">
                  <img src={posePreview} alt={pose?.name || "Pose reference"} />
                  <button type="button" className="ghost" onClick={() => onPose(null)} aria-label="Clear pose">
                    <X size={14} />
                  </button>
                </div>
              ) : (
                <button type="button" className="style-maintain-upload" onClick={() => poseInput.current?.click()} disabled={busy}>
                  <Upload size={14} /> Upload pose image
                </button>
              )}
              <input ref={poseInput} type="file" accept="image/*" hidden onChange={e => setPoseFile(e.target.files)} disabled={poseCap?.available === false} />
              {pose && poseCap?.available !== false && (
                <label>
                  Pose strength
                  <input
                    type="range"
                    min={0.2}
                    max={1.5}
                    step={0.01}
                    value={pose.strength}
                    onChange={e => onPose({ ...pose, strength: +e.target.value })}
                  />
                </label>
              )}
              {!pose && poseCap?.available !== false && (
                <small className="style-maintain-hint">No pose image: describe the new pose in the main prompt.</small>
              )}
            </div>
          </div>

          <ImageExtractActions
            source={look?.image ? { filename: look.image.replace(/^z-image-studio\//, ""), type: "input" } : null}
            busy={busy}
            onNotice={onNotice}
            onPoseExtracted={payload => {
              const strengths = recommendedStyleMaintainStrengths(architecture);
              onPose({
                id: pose?.id || crypto.randomUUID(),
                image: payload.image,
                name: payload.filename,
                mode: "pose",
                strength: pose?.strength ?? strengths.pose
              });
            }}
            onPromptExtracted={onPromptExtracted}
          />
        </>
      )}
    </section>
  );
}
