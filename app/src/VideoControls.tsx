import { AlertTriangle, Dices, Film, ImagePlus, LoaderCircle, Play, Upload, X } from "lucide-react";

export type VideoPriority = "next" | "normal" | "low";
export type VideoForm = {
  prompt: string;
  task: "animation" | "replacement";
  width: number;
  height: number;
  frameCount: number;
  fps: number;
  seed: number;
  steps: number;
  guidance: number;
  priority: VideoPriority;
  poseStrength: number;
  poseStart: number;
  poseEnd: number;
  automaticPreprocessing: boolean;
  outputName: string;
  model: string;
  sourceRecordId?: string;
  /** When set, server copies this Comfy output photo into input as the reference character. */
  galleryImage?: string;
  gallerySubfolder?: string;
};
export type VideoFiles = {
  reference?: File;
  driving?: File;
  referenceMask?: File;
  drivingMask?: File;
};
export type VideoDiagnostics = {
  ready?: boolean;
  connected?: boolean;
  automaticPreprocessing?: boolean;
  missingNodes?: string[];
  files?: Record<string, boolean>;
  ffmpeg?: boolean;
  gpu?: boolean;
  error?: string;
};

/** Mirrors server VIDEO_CANVAS_PRESETS — keep in sync with server/src/video.ts */
const CANVAS_PRESETS = [
  { id: "safe-square", label: "Safe square", width: 512, height: 512, note: "12 GB start" },
  { id: "512-tall", label: "512p tall", width: 512, height: 896, note: "portrait" },
  { id: "9-16-576", label: "9:16 576p", width: 576, height: 1024, note: "exact 9:16" },
  { id: "9-16-640", label: "9:16 640p", width: 640, height: 1152, note: "exact 9:16" },
  { id: "9-16-704", label: "9:16 ~720p", width: 704, height: 1280, note: "704p social" },
  { id: "512-wide", label: "512p wide", width: 896, height: 512, note: "landscape" },
  { id: "704-wide", label: "704p wide", width: 1280, height: 704, note: "landscape HD" }
] as const;

const MOTION_PRESETS = [
  { id: "16fps-short", label: "16 fps · short", fps: 16, frameCount: 17, note: "~1.1 s · light" },
  { id: "30fps-1s", label: "30 fps · ~1 s", fps: 30, frameCount: 29, note: "social short" },
  { id: "30fps-2s", label: "30 fps · ~2 s", fps: 30, frameCount: 61, note: "heavier" },
  { id: "30fps-max", label: "30 fps · max", fps: 30, frameCount: 81, note: "~2.7 s · max" }
] as const;

export const videoDefaults: VideoForm = {
  prompt: "",
  task: "animation",
  width: 704,
  height: 1280,
  frameCount: 29,
  fps: 30,
  seed: 0,
  steps: 40,
  guidance: 5,
  priority: "normal",
  poseStrength: 1,
  poseStart: 0,
  poseEnd: 1,
  automaticPreprocessing: true,
  outputName: "scail-video",
  model: "wan2.1_14B_SCAIL_2_mxfp8.safetensors"
};

function FilePick({ label, accept, file, onChange, required, hint }: {
  label: string; accept: string; file?: File; onChange: (file?: File) => void; required?: boolean; hint?: string;
}) {
  return <label className="file-pick">
    <span>{label}{required ? " *" : ""}</span>
    <input type="file" accept={accept} onChange={event => onChange(event.target.files?.[0])}/>
    <i><Upload/>{file?.name || "Choose file"}</i>
    {hint && <small className="file-pick-hint">{hint}</small>}
  </label>;
}

export function VideoControls({ form, setForm, files, setFiles, diagnostics, busy, onGenerate, galleryPhoto }: {
  form: VideoForm;
  setForm: (next: VideoForm | ((current: VideoForm) => VideoForm)) => void;
  files: VideoFiles;
  setFiles: (next: VideoFiles | ((current: VideoFiles) => VideoFiles)) => void;
  diagnostics: VideoDiagnostics | null;
  busy: boolean;
  onGenerate: () => void;
  /** Optional completed Photo gallery image to use as character reference. */
  galleryPhoto?: { filename: string; subfolder?: string; label?: string } | null;
}) {
  const usingSavedInputs = Boolean(form.sourceRecordId);
  const usingGalleryPhoto = Boolean(form.galleryImage) && !files.reference;
  const hasReference = usingSavedInputs || usingGalleryPhoto || Boolean(files.reference);
  const hasInputs = hasReference && (usingSavedInputs || Boolean(files.driving));
  const masksReady = form.automaticPreprocessing || usingSavedInputs || Boolean(files.referenceMask && files.drivingMask);
  const valid = form.prompt.trim().length >= 10 && hasInputs && masksReady && diagnostics?.ready && !busy;
  const workload = form.width * form.height * form.frameCount * form.steps;
  const high = workload > 512 * 896 * 33 * 40;
  const seconds = (form.frameCount / Math.max(1, form.fps)).toFixed(1);
  const set = <K extends keyof VideoForm>(key: K, value: VideoForm[K]) => setForm({ ...form, [key]: value });

  function applyGalleryPhoto() {
    if (!galleryPhoto?.filename) return;
    setForm({
      ...form,
      galleryImage: galleryPhoto.filename,
      gallerySubfolder: galleryPhoto.subfolder || "",
      sourceRecordId: undefined
    });
    setFiles(current => ({ ...current, reference: undefined }));
  }

  function clearGalleryPhoto() {
    setForm({ ...form, galleryImage: undefined, gallerySubfolder: undefined });
  }

  return <>
    <section className="video-profile">
      <div className="section-title"><span><Film/> SCAIL-2 motion</span><small>{diagnostics?.ready ? "Ready" : "Setup incomplete"}</small></div>
      <select aria-label="Video model profile" value={form.model} onChange={event => set("model", event.target.value)}>
        <option value="wan2.1_14B_SCAIL_2_mxfp8.safetensors">SCAIL-2 MXFP8 · RTX 5070 / 12 GB profile</option>
      </select>
      <p className="model-note">
        Animate a character <strong>image</strong> with motion from an imported <strong>driving video</strong>.
        Target: <strong>30 fps</strong>, <strong>9:16 ~720p</strong> (704×1280 — true 720 is not ÷32 for SCAIL).
      </p>
      {!diagnostics?.ready && <p className="video-warning"><AlertTriangle/>Required video models are downloading or unavailable. Generation stays disabled until diagnostics pass.</p>}
    </section>

    <section>
      <div className="section-title"><span>Task</span><small>Motion transfer</small></div>
      <div className="task-switch" role="radiogroup" aria-label="SCAIL-2 task">
        <button type="button" role="radio" aria-checked={form.task === "animation"} className={form.task === "animation" ? "active" : ""} onClick={() => set("task", "animation")}>Animation</button>
        <button type="button" role="radio" aria-checked={form.task === "replacement"} className={form.task === "replacement" ? "active" : ""} onClick={() => set("task", "replacement")}>Character replacement</button>
      </div>
      <p className="model-note">{form.task === "animation"
        ? "Keep your character; transfer body motion from the driving video (recommended for image → video)."
        : "Replace the person in the driving video with your reference character."}</p>
    </section>

    <section>
      <div className="section-title"><span>Inputs</span><small>Character + motion</small></div>
      {usingSavedInputs && <p className="saved-inputs">Using protected inputs from a previous video. Choose new files below to replace them.</p>}
      {usingGalleryPhoto && (
        <p className="saved-inputs gallery-ref-banner">
          <ImagePlus size={14}/> Character from gallery: <strong>{form.galleryImage}</strong>
          <button type="button" className="ghost" onClick={clearGalleryPhoto}>Clear</button>
        </p>
      )}
      {galleryPhoto?.filename && !files.reference && !usingGalleryPhoto && (
        <button type="button" className="use-gallery-photo" onClick={applyGalleryPhoto}>
          <ImagePlus size={15}/> Use selected photo as character
          {galleryPhoto.label ? ` · ${galleryPhoto.label}` : ""}
        </button>
      )}
      <div className="video-files">
        <FilePick
          label="Reference character image"
          accept=".png,.jpg,.jpeg,.webp"
          file={files.reference}
          required={!usingGalleryPhoto && !usingSavedInputs}
          hint={usingGalleryPhoto ? "Gallery photo selected — optional override file" : "Studio-generated PNG works best"}
          onChange={file => {
            setFiles(current => ({ ...current, reference: file }));
            if (file) clearGalleryPhoto();
          }}
        />
        <FilePick label="Driving motion video" accept=".mp4,.mov,.webm,.mkv" file={files.driving} required onChange={file => setFiles(current => ({ ...current, driving: file }))} hint="Clear single subject, full body when possible"/>
      </div>
    </section>

    <section className="video-prompt">
      <div className="section-title"><span>Result description</span><small>{form.prompt.length}/4000</small></div>
      <textarea value={form.prompt} onChange={event => set("prompt", event.target.value)} maxLength={4000}
        placeholder="A young woman with long dark curly hair, wearing a pink crop top and black shorts, dances in a warmly lit room with soft phone-camera grain."/>
      <p className="prompt-help">
        Describe the <strong>finished video</strong> (who, clothes, action, place). Do not write instructions like “copy this dance.”
        Longer, concrete descriptions work better (official SCAIL-2 guidance).
      </p>
    </section>

    <section>
      <div className="section-title"><span>Canvas</span><small>{form.width} × {form.height}</small></div>
      <div className="video-presets">
        {CANVAS_PRESETS.map(preset =>
          <button
            type="button"
            key={preset.id}
            title={preset.note}
            className={form.width === preset.width && form.height === preset.height ? "active" : ""}
            onClick={() => setForm({ ...form, width: preset.width, height: preset.height })}
          >
            {preset.label}
          </button>
        )}
      </div>
      <p className="prompt-help">SCAIL needs both sides divisible by 32. <strong>9:16 ~720p</strong> uses 704×1280 (official 704p class). Exact 9:16: 576×1024 or 640×1152.</p>
    </section>

    <section>
      <div className="section-title"><span>Motion / FPS</span><small>{seconds}s · {form.frameCount} frames</small></div>
      <div className="video-presets">
        {MOTION_PRESETS.map(preset =>
          <button
            type="button"
            key={preset.id}
            title={preset.note}
            className={form.fps === preset.fps && form.frameCount === preset.frameCount ? "active" : ""}
            onClick={() => setForm({ ...form, fps: preset.fps, frameCount: preset.frameCount })}
          >
            {preset.label}
          </button>
        )}
      </div>
      <div className="three video-numbers">
        <label>Frames<input type="number" min={9} max={81} step={4} value={form.frameCount} onChange={event => set("frameCount", Number(event.target.value))}/></label>
        <label>FPS<input type="number" min={4} max={30} value={form.fps} onChange={event => set("fps", Number(event.target.value))}/></label>
        <label>Seconds<input readOnly value={seconds}/></label>
      </div>
      <p className="prompt-help">Frames must be 9, 13, 17…81. Output length = frames ÷ FPS. Driving video must contain at least that many frames.</p>
      {high && <p className="video-warning"><AlertTriangle/>Heavy for 12 GB (especially 704×1280 × 61+ frames × 40 steps). Prefer 576×1024 or fewer frames first.</p>}
    </section>

    <section>
      <details className="video-advanced">
        <summary>Advanced settings</summary>
        <div className="two">
          <label>Steps<input type="number" min={1} max={60} value={form.steps} onChange={event => set("steps", Number(event.target.value))}/></label>
          <label>Guidance<input type="number" min={0} max={10} step={0.1} value={form.guidance} onChange={event => set("guidance", Number(event.target.value))}/></label>
        </div>
        <div className="two">
          <label>Pose strength<input type="number" min={0} max={3} step={0.05} value={form.poseStrength} onChange={event => set("poseStrength", Number(event.target.value))}/></label>
          <label>Priority<select value={form.priority} onChange={event => set("priority", event.target.value as VideoPriority)}><option value="next">Next</option><option value="normal">Normal</option><option value="low">Low</option></select></label>
        </div>
        <label>Seed<div className="seed"><input type="number" value={form.seed} onChange={event => set("seed", Number(event.target.value))}/><button type="button" onClick={() => set("seed", Math.floor(Math.random() * Number.MAX_SAFE_INTEGER))} aria-label="Choose a random video seed"><Dices/></button><button type="button" onClick={() => set("seed", 0)} aria-label="Clear video seed"><X/></button></div></label>
        <label className="auto-mask"><input type="checkbox" checked={form.automaticPreprocessing} disabled={diagnostics?.automaticPreprocessing === false} onChange={event => set("automaticPreprocessing", event.target.checked)}/><span>Automatically create semantic masks with local SAM 3.1</span></label>
        <div className="mask-explainer"><strong>How SCAIL masks work</strong><p>Black hides background, white preserves background, and colors link the same person between reference and driving frames. Wrong masks can make animation behave like replacement.</p></div>
        {!form.automaticPreprocessing && <div className="video-files">
          <FilePick label="Reference semantic mask" accept=".png,.jpg,.jpeg,.webp" file={files.referenceMask} required onChange={file => setFiles(current => ({ ...current, referenceMask: file }))}/>
          <FilePick label="Frame-aligned driving mask video" accept=".mp4,.mov,.webm,.mkv" file={files.drivingMask} required onChange={file => setFiles(current => ({ ...current, drivingMask: file }))}/>
        </div>}
      </details>
    </section>

    <button id="generate-button" type="button" className="generate" disabled={!valid} onClick={onGenerate}>
      {busy ? <LoaderCircle className="spin"/> : <Play/>}
      <span>Generate MP4 · {form.width}×{form.height} · {form.fps}fps · {seconds}s</span>
      <kbd>Ctrl ↵</kbd>
    </button>
  </>;
}
