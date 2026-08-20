import React, { useRef } from "react";
import { Shuffle, Upload, X } from "lucide-react";

export type RemixSource = {
  filename: string;
  subfolder: string;
  type: string;
  label: string;
};

type Props = {
  enabled: boolean;
  onEnabled: (next: boolean) => void;
  source: RemixSource | null;
  onSource: (next: RemixSource | null) => void;
  strength: number;
  noise: number;
  lockStructure: boolean;
  onStrength: (v: number) => void;
  onNoise: (v: number) => void;
  onLockStructure: (v: boolean) => void;
  promptEmpty: boolean;
  busy?: boolean;
  onPrepareError?: (message: string) => void;
};

export function ImageRemixPanel({
  enabled,
  onEnabled,
  source,
  onSource,
  strength,
  noise,
  lockStructure,
  onStrength,
  onNoise,
  onLockStructure,
  promptEmpty,
  busy,
  onPrepareError
}: Props) {
  const input = useRef<HTMLInputElement>(null);

  async function uploadFile(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    try {
      const body = new FormData();
      body.append("image", file);
      const res = await fetch("/api/remix/prepare", { method: "POST", body });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.error || `Upload failed (${res.status})`);
      onSource({
        filename: String(payload.filename),
        subfolder: String(payload.subfolder || ""),
        type: String(payload.type || "input"),
        label: String(payload.label || file.name)
      });
      onEnabled(true);
    } catch (e: any) {
      onPrepareError?.(e.message || "Could not prepare remix image");
    } finally {
      if (input.current) input.current.value = "";
    }
  }

  return (
    <section className={`image-remix-panel ${enabled ? "active" : ""}`}>
      <div className="section-title">
        <span><Shuffle size={16} /> Image Remix</span>
        <small>Img2img · prompt optional</small>
      </div>
      <label className="image-remix-toggle">
        <input type="checkbox" checked={enabled} disabled={busy} onChange={e => onEnabled(e.target.checked)} />
        <span>
          <strong>Enable Image Remix</strong>
          <small>
            {enabled
              ? "On: base image drives the run. Prompt is optional — leave blank to remix with model/LoRAs only. Strength/Noise work like NovelAI Image2Image."
              : "Off (default). Turn on to remix an image under any Photo model and LoRA stack without requiring a prompt."}
          </small>
        </span>
      </label>

      {enabled && (
        <>
          <p className="image-remix-blurb">
            Pick a base image, optionally write a steering prompt, switch model/LoRAs, then Generate.
            Low Strength ≈ stay close to the image; higher Strength ≈ freer reinterpret.
          </p>

          <div className="image-remix-source">
            {source ? (
              <div className="image-remix-preview">
                <div>
                  <strong title={source.label}>{source.label}</strong>
                  <small>{source.type === "input" ? "Staged input" : "Gallery output"} · Strength {strength.toFixed(2)}</small>
                </div>
                <button type="button" className="ghost" onClick={() => onSource(null)} aria-label="Clear remix source">
                  <X size={14} />
                </button>
              </div>
            ) : (
              <button type="button" className="image-remix-upload" disabled={busy} onClick={() => input.current?.click()}>
                <Upload size={14} /> Upload base image
              </button>
            )}
            <input ref={input} type="file" accept="image/*" hidden onChange={e => uploadFile(e.target.files)} />
          </div>

          <div className="image-remix-presets">
            {([
              ["Near copy", 0.2, 0.02, true],
              ["Light remix", 0.35, 0.08, true],
              ["Remix", 0.5, 0.15, false],
              ["Reinterpret", 0.7, 0.25, false]
            ] as Array<[string, number, number, boolean]>).map(([label, s, n, lock]) => (
              <button
                type="button"
                key={label}
                className={strength === s && noise === n ? "active" : ""}
                onClick={() => { onStrength(s); onNoise(n); onLockStructure(lock); }}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="two">
            <label>
              Strength
              <input type="range" min={0.05} max={1} step={0.01} value={strength} onChange={e => onStrength(+e.target.value)} />
              <small>{strength.toFixed(2)} — how far to leave the base image</small>
            </label>
            <label>
              Noise
              <input type="range" min={0} max={1} step={0.01} value={noise} onChange={e => onNoise(+e.target.value)} />
              <small>{noise.toFixed(2)} — extra detail freedom</small>
            </label>
          </div>

          <label className="image-remix-lock">
            <input type="checkbox" checked={lockStructure} onChange={e => onLockStructure(e.target.checked)} />
            <span>
              <strong>Lock structure</strong>
              <small>Re-feed edges/depth so framing stays closer (less free pose change).</small>
            </span>
          </label>

          {promptEmpty && (
            <p className="image-remix-hint" role="status">
              Prompt is empty — Remix will use a neutral placeholder and lean on the base image + model/LoRAs.
            </p>
          )}
          {!source && (
            <p className="image-remix-warn" role="status">
              Add a base image (upload or gallery <em>Remix</em>) before generating.
            </p>
          )}
        </>
      )}
    </section>
  );
}
