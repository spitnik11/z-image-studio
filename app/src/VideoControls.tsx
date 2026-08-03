import { AlertTriangle, Dices, Film, LoaderCircle, Play, Upload, X } from "lucide-react";

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

export const videoDefaults: VideoForm = {
  prompt: "",
  task: "animation",
  width: 512,
  height: 512,
  frameCount: 17,
  fps: 16,
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

function FilePick({ label, accept, file, onChange, required }: {
  label: string; accept: string; file?: File; onChange: (file?: File) => void; required?: boolean;
}) {
  return <label className="file-pick">
    <span>{label}{required ? " *" : ""}</span>
    <input type="file" accept={accept} onChange={event => onChange(event.target.files?.[0])}/>
    <i><Upload/>{file?.name || "Choose file"}</i>
  </label>;
}

export function VideoControls({ form, setForm, files, setFiles, diagnostics, busy, onGenerate }: {
  form: VideoForm;
  setForm: (next: VideoForm | ((current: VideoForm) => VideoForm)) => void;
  files: VideoFiles;
  setFiles: (next: VideoFiles | ((current: VideoFiles) => VideoFiles)) => void;
  diagnostics: VideoDiagnostics | null;
  busy: boolean;
  onGenerate: () => void;
}) {
  const usingSavedInputs = Boolean(form.sourceRecordId);
  const hasInputs = usingSavedInputs || Boolean(files.reference && files.driving);
  const masksReady = form.automaticPreprocessing || usingSavedInputs || Boolean(files.referenceMask && files.drivingMask);
  const valid = form.prompt.trim().length >= 10 && hasInputs && masksReady && diagnostics?.ready && !busy;
  const workload = form.width * form.height * form.frameCount * form.steps;
  const high = workload > 512 * 896 * 33 * 40;
  const set = <K extends keyof VideoForm>(key: K, value: VideoForm[K]) => setForm({ ...form, [key]: value });

  return <>
    <section className="video-profile">
      <div className="section-title"><span><Film/> SCAIL-2 motion</span><small>{diagnostics?.ready ? "Ready" : "Setup incomplete"}</small></div>
      <select aria-label="Video model profile" value={form.model} onChange={event => set("model", event.target.value)}>
        <option value="wan2.1_14B_SCAIL_2_mxfp8.safetensors">SCAIL-2 MXFP8 · RTX 5070 profile</option>
      </select>
      {!diagnostics?.ready && <p className="video-warning"><AlertTriangle/>Required video models are downloading or unavailable. Generation stays disabled until diagnostics pass.</p>}
    </section>

    <section>
      <div className="section-title"><span>Task</span><small>Motion transfer</small></div>
      <div className="task-switch" role="radiogroup" aria-label="SCAIL-2 task">
        <button role="radio" aria-checked={form.task === "animation"} className={form.task === "animation" ? "active" : ""} onClick={() => set("task", "animation")}>Animation</button>
        <button role="radio" aria-checked={form.task === "replacement"} className={form.task === "replacement" ? "active" : ""} onClick={() => set("task", "replacement")}>Character replacement</button>
      </div>
      <p className="model-note">{form.task === "animation" ? "Animate the reference character using motion from the driving video." : "Replace the selected person in the driving video with the reference character."}</p>
    </section>

    <section>
      <div className="section-title"><span>Inputs</span><small>Local files</small></div>
      {usingSavedInputs && <p className="saved-inputs">Using the protected inputs from a previous video. Choose new files below to replace them.</p>}
      <div className="video-files">
        <FilePick label="Reference character image" accept=".png,.jpg,.jpeg,.webp" file={files.reference} required onChange={file => setFiles(current => ({ ...current, reference: file }))}/>
        <FilePick label="Driving video" accept=".mp4,.mov,.webm,.mkv" file={files.driving} required onChange={file => setFiles(current => ({ ...current, driving: file }))}/>
      </div>
    </section>

    <section className="video-prompt">
      <div className="section-title"><span>Result description</span><small>{form.prompt.length}/4000</small></div>
      <textarea value={form.prompt} onChange={event => set("prompt", event.target.value)} maxLength={4000}
        placeholder="A woman with short black hair, wearing a red jacket and dark trousers, dances energetically in a warmly lit studio."/>
      <p className="prompt-help">Describe the completed video. Avoid instructions such as “make her copy this dance.” Detailed descriptions usually work better.</p>
    </section>

    <section>
      <div className="section-title"><span>Output</span><small>{form.width} × {form.height}</small></div>
      <div className="video-presets">
        {([["Safe square",512,512],["512p wide",896,512],["512p tall",512,896],["704p wide",1280,704]] as const).map(([name,width,height]) =>
          <button key={name} className={form.width === width && form.height === height ? "active" : ""} onClick={() => setForm({ ...form, width, height })}>{name}</button>
        )}
      </div>
      <div className="three video-numbers">
        <label>Frames<input type="number" min="9" max="81" step="4" value={form.frameCount} onChange={event => set("frameCount", Number(event.target.value))}/></label>
        <label>FPS<input type="number" min="4" max="30" value={form.fps} onChange={event => set("fps", Number(event.target.value))}/></label>
        <label>Seconds<input readOnly value={(form.frameCount / form.fps).toFixed(1)}/></label>
      </div>
      {high && <p className="video-warning"><AlertTriangle/>This is a heavy workload for 12 GB VRAM. Start with 512×512 and 17 frames.</p>}
    </section>

    <section>
      <details className="video-advanced">
        <summary>Advanced settings</summary>
        <div className="two">
          <label>Steps<input type="number" min="1" max="60" value={form.steps} onChange={event => set("steps", Number(event.target.value))}/></label>
          <label>Guidance<input type="number" min="0" max="10" step=".1" value={form.guidance} onChange={event => set("guidance", Number(event.target.value))}/></label>
        </div>
        <div className="two">
          <label>Pose strength<input type="number" min="0" max="3" step=".05" value={form.poseStrength} onChange={event => set("poseStrength", Number(event.target.value))}/></label>
          <label>Priority<select value={form.priority} onChange={event => set("priority", event.target.value as VideoPriority)}><option value="next">Next</option><option value="normal">Normal</option><option value="low">Low</option></select></label>
        </div>
        <label>Seed<div className="seed"><input type="number" value={form.seed} onChange={event => set("seed", Number(event.target.value))}/><button onClick={() => set("seed", Math.floor(Math.random() * Number.MAX_SAFE_INTEGER))} aria-label="Choose a random video seed"><Dices/></button><button onClick={() => set("seed", 0)} aria-label="Clear video seed"><X/></button></div></label>
        <label className="auto-mask"><input type="checkbox" checked={form.automaticPreprocessing} disabled={diagnostics?.automaticPreprocessing === false} onChange={event => set("automaticPreprocessing", event.target.checked)}/><span>Automatically create semantic masks with local SAM 3.1</span></label>
        <div className="mask-explainer"><strong>How SCAIL masks work</strong><p>Black hides background, white preserves background, and colors link the same person or region between the reference and driving frames. Wrong masks can make animation behave like replacement.</p></div>
        {!form.automaticPreprocessing && <div className="video-files">
          <FilePick label="Reference semantic mask" accept=".png,.jpg,.jpeg,.webp" file={files.referenceMask} required onChange={file => setFiles(current => ({ ...current, referenceMask: file }))}/>
          <FilePick label="Frame-aligned driving mask video" accept=".mp4,.mov,.webm,.mkv" file={files.drivingMask} required onChange={file => setFiles(current => ({ ...current, drivingMask: file }))}/>
        </div>}
      </details>
    </section>

    <button id="generate-button" className="generate" disabled={!valid} onClick={onGenerate}>
      {busy ? <LoaderCircle className="spin"/> : <Play/>}<span>Generate MP4</span><kbd>Ctrl ↵</kbd>
    </button>
  </>;
}
