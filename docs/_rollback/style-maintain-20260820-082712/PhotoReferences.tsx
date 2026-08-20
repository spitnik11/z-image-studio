import React, { useRef } from "react";
import { Plus, Trash2 } from "lucide-react";

export type PhotoReference = {
  id: string;
  file?: File;
  image?: string;
  name: string;
  mode: "pose" | "direct" | "face";
  strength: number;
};
export type ReferenceCapability = {
  id: "identity" | "face" | "pose" | "depth" | "structure" | "face-refinement" | "upscale" | "transparent-asset";
  available: boolean;
  provider?: string;
  message: string;
  missing: string[];
};

export function PhotoReferences({
  references,
  onChange,
  disabled,
  architecture,
  consistentCharacter,
  faceRefinement,
  capabilities,
  onConsistencyChange,
  defaultMode = "pose",
  allowedModes = ["pose", "direct", "face"],
  remainingSlots,
  showConsistency = true,
  title = "Reference guidance"
}: {
  references: PhotoReference[];
  onChange: (next: PhotoReference[]) => void;
  disabled?: boolean;
  architecture?: "z-image" | "krea2" | "illustrious" | "anima" | "unknown";
  consistentCharacter: boolean;
  faceRefinement: boolean;
  capabilities?: ReferenceCapability[];
  onConsistencyChange: (consistent: boolean, refineFace: boolean) => void;
  defaultMode?: PhotoReference["mode"];
  allowedModes?: PhotoReference["mode"][];
  remainingSlots?: number;
  showConsistency?: boolean;
  title?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  function add(files: FileList | null) {
    const available = Math.max(0, remainingSlots ?? 4 - references.length);
    const next = Array.from(files || []).slice(0, available).map(file => ({
      id: crypto.randomUUID(),
      file,
      name: file.name,
      mode: defaultMode,
      strength: 1
    }));
    if (next.length) onChange([...references, ...next]);
    if (input.current) input.current.value = "";
  }
  function update(id: string, patch: Partial<PhotoReference>) {
    onChange(references.map(reference => reference.id === id ? { ...reference, ...patch } : reference));
  }
  const capability = (id: ReferenceCapability["id"]) => capabilities?.find(item => item.id === id);
  const pose = capability("pose");
  const direct = capability(architecture === "krea2" ? "identity" : "structure");
  const face = capability("face-refinement");
  const faceReference = capability("face");
  const faceOnly = allowedModes.every(mode => mode === "face" || mode === "direct");
  const poseOnly = allowedModes.length === 1 && allowedModes[0] === "pose";

  return <section className="photo-references">
    <div className="section-title">
      <span>{title}</span>
      <small>{references.length}/4</small>
    </div>
    <p className="reference-intro">{architecture === "illustrious"
      ? "Illustrious uses SDXL ControlNets: Pose (OpenPose) for body placement, Structure/Face (Canny) for silhouette. Prefer a character LoRA for true identity."
      : architecture === "anima"
      ? "Anima uses LLLite control: Pose (OpenPose stick figure) or Structure/Face (Canny + lineart). Prefer a character LoRA for identity lock."
      : faceOnly
      ? architecture === "krea2"
        ? "Use native Krea Identity Edit for strong face and identity preservation. Direct mode retains more of the full reference."
        : "Face preservation is approximate on Z-Image: structural guidance and a low-denoise face detail pass improve resemblance. Use a face LoRA for a true identity lock."
      : poseOnly
      ? architecture === "krea2"
        ? "Krea 2 uses depth guidance to follow body placement, camera angle, and composition."
        : "Follow body, hand, face, and foot keypoints without copying clothing or background."
      : architecture === "krea2"
      ? "Krea 2 uses depth for pose and composition, or identity editing for a closer direct copy. Use one Pose reference or up to two Direct Copy references."
      : "Match a person’s pose, or preserve more of a reference image’s silhouette and composition. Each image is fitted to the selected canvas before guidance is applied."}</p>
    {capabilities && <div className="capability-summary" aria-label="Reference feature availability">
      {[pose, direct, faceReference, face, capability("upscale")].filter(Boolean).map(item =>
        <span key={item!.id} className={item!.available ? "available" : "unavailable"} title={item!.message}>
          {item!.available ? "✓" : "—"} {item!.id === "face" ? "Face reference" : item!.id === "face-refinement" ? "Face polish" : item!.id === "upscale" ? "Neural upscale" : item!.id === "identity" ? "Identity" : item!.id === "structure" ? "Structure" : "Pose"}
        </span>)}
    </div>}
    <input
      ref={input}
      hidden
      type="file"
      accept=".png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp"
      multiple
      onChange={event => add(event.target.files)}
    />
    <button className="reference-add" type="button" disabled={disabled || (remainingSlots ?? 4 - references.length) <= 0} onClick={() => input.current?.click()}>
      <Plus size={15}/> Add {defaultMode === "face" ? "face" : defaultMode === "pose" ? "pose" : "direct"} reference
    </button>
    <div className="consistency-options finishing-options">
      <label><input type="checkbox" checked={faceRefinement} disabled={face?.available === false} onChange={event => onConsistencyChange(consistentCharacter, event.target.checked)}/><span><strong>Face polish</strong><small>{face?.available === false ? face.message : "Optional. Detect faces on the finished image and run a low-denoise Face Detailer pass; the polished image is the only output. Not an identity lock — use a face LoRA for that."}</small></span></label>
      {showConsistency&&<>
      <label><input type="checkbox" checked={consistentCharacter} disabled={architecture === "illustrious" || architecture === "anima" || direct?.available === false} onChange={event => onConsistencyChange(event.target.checked, faceRefinement)}/><span><strong>Character Consistency</strong><small>{architecture === "illustrious" || architecture === "anima" ? "Use separate Pose + Structure/Face references for this model family (master Identity Consistency is Z-Image/Krea only)." : direct?.available === false ? direct.message : "Use one Identity / Direct image as the master character and one Pose image as the target body position."}</small></span></label>
      </>}
    </div>
    {references.map((reference, index) => <div className="reference-card" key={reference.id}>
      <div className="reference-card-head">
        <div><strong>Reference {index + 1}</strong><small title={reference.name}>{reference.name}</small></div>
        <button type="button" aria-label={`Remove reference ${index + 1}`} onClick={() => onChange(references.filter(item => item.id !== reference.id))}><Trash2 size={15}/></button>
      </div>
      <div className="reference-mode" role="radiogroup" aria-label={`Reference ${index + 1} mode`}>
        {allowedModes.includes("pose")&&<button type="button" disabled={pose?.available === false} title={pose?.message} className={reference.mode === "pose" ? "active" : ""} onClick={() => update(reference.id, { mode: "pose" })}>Pose only</button>}
        {allowedModes.includes("direct")&&<button type="button" disabled={direct?.available === false} title={direct?.message} className={reference.mode === "direct" ? "active" : ""} onClick={() => update(reference.id, { mode: "direct" })}>{architecture === "krea2" ? "Identity / Direct" : "Structure / Direct"}</button>}
        {allowedModes.includes("face")&&<button type="button" disabled={faceReference?.available === false} title={faceReference?.message} className={reference.mode === "face" ? "active" : ""} onClick={() => update(reference.id, { mode: "face" })}>Face</button>}
      </div>
      <p>{reference.mode === "face"
        ? architecture === "krea2" ? "Uses native Krea Identity Edit for strong face and identity preservation." : "Approximate only: uses structural guidance plus a low-denoise Face Detailer pass. Train a face LoRA for a true identity lock."
        : reference.mode === "pose"
        ? architecture === "krea2" ? "Uses depth to retain body placement, camera angle, and scene composition without directly copying identity." : "Uses body, hands, face, and feet keypoints without copying clothing or background."
        : architecture === "krea2" ? "Uses Krea identity editing to retain the subject’s appearance while following your prompt." : "Uses edge structure to retain more silhouette, framing, and scene composition."}</p>
      <label className="reference-strength">
        <span>Influence <output>{reference.strength.toFixed(2)}</output></span>
        <input
          type="range"
          min="0"
          max="2"
          step="0.05"
          value={reference.strength}
          onChange={event => update(reference.id, { strength: Number(event.target.value) })}
        />
      </label>
    </div>)}
  </section>;
}
