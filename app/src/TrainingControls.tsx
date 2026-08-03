import React, { useEffect, useMemo, useRef, useState } from "react";
import { Activity, AlertTriangle, Check, Clock3, Cpu, FolderOpen, Gauge, ImagePlus, Layers3, LoaderCircle, Play, Trash2, Upload } from "lucide-react";

type TrainingModel = { name: string; architecture: "z-image" | "krea2"; trainable: boolean; trainingBase?: string; setupMessage?: string };
type TrainingDiagnostics = {
  ready: boolean;
  engine?: string;
  missingFiles?: string[];
  models: TrainingModel[];
  recommendations?: Record<string, string | number>;
  error?: string;
};
export type TrainingJob = {
  id: string; promptId: string; name: string; trigger: string; model: string;
  status: string; progress: number; imageCount: number; steps: number; rank: number;
  resolution: number; installedName?: string; error?: string; durationMs?: number; phase?: string; currentStep?: number;
  recommendedStrength?: number;
  telemetry?: {
    sampledAt: string;
    cpuPercent: number | null;
    gpu: { utilizationPercent: number; memoryUsedMb: number; memoryTotalMb: number; temperatureC: number; powerWatts: number } | null;
    progress: { currentStep: number; totalSteps: number; percent: number; elapsedSeconds: number | null; etaSeconds: number | null; secondsPerIteration: number | null } | null;
    elapsedSeconds: number;
    etaSeconds: number | null;
    secondsPerIteration: number | null;
  };
};
type TrainingPicture = { id: string; file: File; preview: string; caption: string };
type TrainingPreview = {
  architecture: "z-image" | "krea2"; trainingBase: string; targetModel: string; imageCount: number;
  estimatedWorkingGb: number; vramProfile: string; recommendedStrength: number;
  config: Record<string, unknown>; commands: Array<{ phase: string; command: string }>;
};

const presets = {
  quick: { label: "Quick test", resolution: 512, steps: 250, rank: 8, description: "Confirm identity, captions, and the trigger with the lightest verified profile." },
  balanced: { label: "Balanced", resolution: 512, steps: 500, rank: 16, description: "Recommended starting point for this 12 GB GPU." },
  detailed: { label: "Detailed", resolution: 768, steps: 800, rank: 32, description: "Slower and more memory-intensive; best after Balanced succeeds." }
} as const;

function formatDuration(seconds: number | null | undefined) {
  if (seconds == null || !Number.isFinite(seconds)) return "Calculating…";
  const minutes = Math.max(0, Math.round(seconds / 60));
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const remaining = minutes % 60;
  return days ? `${days}d ${hours}h` : hours ? `${hours}h ${remaining}m` : `${remaining}m`;
}

export function TrainingControls({ onUse, onExit, datasetId }: { onUse: (name: string) => void; onExit: () => void; datasetId?: string }) {
  const [diagnostics, setDiagnostics] = useState<TrainingDiagnostics | null>(null);
  const [jobs, setJobs] = useState<TrainingJob[]>([]);
  const [pictures, setPictures] = useState<TrainingPicture[]>([]);
  const [name, setName] = useState("");
  const [trigger, setTrigger] = useState("");
  const [model, setModel] = useState("");
  const [preset, setPreset] = useState<keyof typeof presets>("balanced");
  const [notice, setNotice] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [preview, setPreview] = useState<TrainingPreview | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [cancelling, setCancelling] = useState<string>();
  const [logs, setLogs] = useState<Record<string, string>>({});
  const filesInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const active = jobs.find(job => ["pending", "active"].includes(job.status));
  const setting = presets[preset];
  const trainableModels = diagnostics?.models.filter(item => item.trainable) || [];

  async function refresh() {
    const [diagResponse, jobsResponse] = await Promise.all([fetch("/api/training/diagnostics"), fetch("/api/training")]);
    const diag = await diagResponse.json();
    const nextJobs = await jobsResponse.json();
    setDiagnostics(diag);
    setJobs(nextJobs);
    setModel(current => current || diag.models?.find((item: TrainingModel) => item.trainable)?.name || "");
  }
  useEffect(() => {
    refresh().catch(error => setNotice(error.message));
    const timer = window.setInterval(() => refresh().catch(() => {}), 5000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    setConfirmed(false);
    if (!name.trim() || !trigger.trim() || !model) { setPreview(null); return; }
    const controller = new AbortController();
    const timer = window.setTimeout(() => { void (async () => {
      const response = await fetch("/api/training/preview", {
        method: "POST", headers: { "content-type": "application/json" }, signal: controller.signal,
        body: JSON.stringify({ imageCount: pictures.length, config: {
          name, trigger, model, resolution: setting.resolution, steps: setting.steps,
          rank: setting.rank, learningRate: 0.0001, gradAccumulation: 4, seed: 42
        } })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Could not prepare the training preview.");
      setPreview(payload);
    })().catch(error => { if (error?.name !== "AbortError") setNotice(error.message); }); }, 300);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [name, trigger, model, preset, pictures.length]);
  useEffect(() => {
    // Only running jobs have logs that change; terminal jobs are fetched once.
    // Polling terminal (failed/cancelled) jobs forever floods the console with
    // 400s when an old job's log path is stale.
    const running = jobs.filter(job => ["pending", "active"].includes(job.status)).slice(0, 3);
    const terminal = jobs.filter(job => ["failed", "cancelled"].includes(job.status)).slice(0, 3);
    if (!running.length && !terminal.length) return;
    let stopped = false;
    const load = async (list: TrainingJob[]) => {
      const entries = await Promise.all(list.map(async job => {
        const response = await fetch(`/api/training/${encodeURIComponent(job.id)}/log`);
        const payload = await response.json().catch(() => ({}));
        return [job.id, response.ok ? String(payload.text || "") : ""] as const;
      }));
      if (!stopped) setLogs(current => ({ ...current, ...Object.fromEntries(entries) }));
    };
    load([...running, ...terminal]).catch(() => {});
    const timer = running.length ? window.setInterval(() => load(running).catch(() => {}), 3000) : 0;
    return () => { stopped = true; if (timer) window.clearInterval(timer); };
  }, [jobs.map(job => `${job.id}:${job.status}`).join("|")]);
  useEffect(() => {
    if (!datasetId) return;
    (async () => {
      const [datasetResponse, reviewResponse] = await Promise.all([
        fetch(`/api/datasets/${encodeURIComponent(datasetId)}`),
        fetch(`/api/datasets/${encodeURIComponent(datasetId)}/review`)
      ]);
      const dataset = await datasetResponse.json();
      const review = await reviewResponse.json();
      if (!datasetResponse.ok) throw new Error(dataset.error || "Could not import the dataset.");
      if (!reviewResponse.ok) throw new Error(review.error || "Could not load the reviewed dataset.");
      const kept = review.items.filter((item: { state: string }) => item.state === "keep");
      if (kept.length < 3) throw new Error("Keep at least 3 reviewed images before opening LoRA Lab.");
      const imported = await Promise.all(kept.map(async (item: { image: string; renderedCaption: string }) => {
        const filename = item.image;
        const image = await fetch(`/api/datasets/${encodeURIComponent(datasetId)}/images/${encodeURIComponent(filename)}`);
        const blob = await image.blob();
        const file = new File([blob], filename, { type: blob.type || "image/png" });
        return { id: crypto.randomUUID(), file, preview: URL.createObjectURL(file), caption: item.renderedCaption || dataset.trigger };
      }));
      setPictures(imported);
      setName(`${dataset.name} LoRA`);
      setTrigger(dataset.trigger);
      setModel(dataset.model);
      setNotice(`Imported ${imported.length} kept images with their latest saved captions.`);
    })().catch(error => setNotice(error.message));
  }, [datasetId]);

  function addPictures(files: FileList | null) {
    const available = Math.max(0, 100 - pictures.length);
    const existing = new Set(pictures.map(picture => `${picture.file.name}:${picture.file.size}:${picture.file.lastModified}`));
    const candidates = Array.from(files || []).filter(file => /\.(png|jpe?g|webp)$/i.test(file.name));
    const unique = candidates.filter(file => !existing.has(`${file.name}:${file.size}:${file.lastModified}`)).slice(0, available);
    const next = unique.map(file => ({
      id: crypto.randomUUID(), file, preview: URL.createObjectURL(file), caption: trigger
    }));
    setPictures(current => [...current, ...next]);
    if (candidates.length !== next.length) setNotice(`${next.length} picture${next.length === 1 ? "" : "s"} added. Duplicate, unsupported, or over-limit files were skipped.`);
    if (filesInput.current) filesInput.current.value = "";
    if (folderInput.current) folderInput.current.value = "";
  }
  function changeTrigger(value: string) {
    const previous = trigger;
    setTrigger(value);
    setPictures(current => current.map(picture => ({ ...picture, caption: !picture.caption || picture.caption === previous ? value : picture.caption })));
  }
  async function start() {
    setNotice("");
    if (pictures.length < 3) return setNotice("Add at least 3 pictures. For stronger results, use 12–30 varied pictures.");
    if (!name.trim() || !trigger.trim() || !model) return setNotice("Choose a name, trigger phrase, and training model.");
    setSubmitting(true);
    try {
      const body = new FormData();
      body.append("config", JSON.stringify({
        name, trigger, model, resolution: setting.resolution, steps: setting.steps,
        rank: setting.rank, learningRate: 0.0001, gradAccumulation: 4, seed: 42
      }));
      body.append("captions", JSON.stringify(pictures.map(picture => picture.caption || trigger)));
      pictures.forEach(picture => body.append("images", picture.file));
      const response = await fetch("/api/training", { method: "POST", body });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || `Training request failed (${response.status})`);
      setJobs(current => [payload, ...current]);
    } catch (error: any) { setNotice(error.message); }
    finally { setSubmitting(false); }
  }
  async function cancel(id: string) {
    setCancelling(id);
    const response = await fetch(`/api/training/${encodeURIComponent(id)}/cancel`, { method: "POST" });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) setNotice(payload.error || "Could not cancel training.");
    else { setNotice("Cancellation requested. The local trainer is stopping safely."); await refresh(); }
    setCancelling(undefined);
  }
  const selectedTrainingModel = diagnostics?.models.find(item => item.name === model);
  const modelWarning = selectedTrainingModel?.architecture === "krea2" && !selectedTrainingModel.trainable
    ? "Krea training requires the Raw checkpoint and BF16 training encoder. Turbo generation remains available while setup is incomplete."
    : "";
  const captioned = pictures.filter(picture => picture.caption.trim()).length;
  const readiness = [
    { ready: Boolean(name.trim()), text: "Name your LoRA" },
    { ready: Boolean(trigger.trim()), text: "Add a trigger phrase" },
    { ready: pictures.length >= 3, text: "Add at least 3 pictures" },
    { ready: captioned === pictures.length && pictures.length > 0, text: "Caption every picture" },
    { ready: Boolean(selectedTrainingModel?.trainable), text: "Choose a ready model" },
    { ready: Boolean(preview), text: "Prepare the local preflight" },
    { ready: confirmed, text: "Confirm the preflight" }
  ];
  const canStart = readiness.every(item => item.ready) && !submitting && !active && Boolean(diagnostics?.ready);
  function clearPictures() {
    if (!pictures.length || !window.confirm(`Remove all ${pictures.length} pictures from this draft?`)) return;
    pictures.forEach(picture => URL.revokeObjectURL(picture.preview));
    setPictures([]);
  }
  function fillEmptyCaptions() {
    setPictures(current => current.map(picture => ({ ...picture, caption: picture.caption.trim() || trigger.trim() })));
  }

  return <div className="training-workspace">
    <nav className="training-nav"><button onClick={onExit}>← Back to Photo mode</button><span>Local LoRA Training</span></nav>
    <aside className="training-builder">
      <div className="eyebrow">LORA LAB</div>
      <h1>Train a reusable LoRA</h1>
      <p className="intro">Prepare the pictures, choose the matching model, review the local plan, then train.</p>

      {notice && <p className={/^Imported|added\./i.test(notice) ? "training-notice success" : "training-notice"}>{notice}</p>}
      <section className="training-step">
        <div className="section-title"><span>1. Name your LoRA</span></div>
        <label>LoRA name<input value={name} onChange={event => setName(event.target.value)} placeholder="My character or style"/></label>
        <label>Trigger phrase<input value={trigger} onChange={event => changeTrigger(event.target.value)} placeholder="photo of zperson"/><small>Include this phrase in future prompts to call up the trained concept.</small></label>
      </section>
      <section className="training-step">
        <div className="section-title"><span>2. Training model</span></div>
        <select aria-label="Training model" value={model} onChange={event => setModel(event.target.value)}>
          <option value="">Choose a model</option>
          {diagnostics?.models.map(item => <option key={item.name} value={item.name} disabled={!item.trainable}>
            {item.architecture === "z-image" ? "Z-Image" : "Krea 2"} · {item.name}{item.trainable ? ` · trains on ${item.trainingBase}` : " · setup required"}
          </option>)}
        </select>
        {diagnostics?.models.find(item => item.name === model)?.setupMessage && <p className="training-tip">{diagnostics.models.find(item => item.name === model)?.setupMessage}</p>}
        <p className="training-tip">{diagnostics?.models.find(item => item.name === model)?.architecture === "krea2"
          ? "Krea adapters train on Krea 2 Raw, then install for your selected Krea 2 Turbo model."
          : "Training uses Z-Image Base for stable learning, then installs the finished LoRA for the compatible Z-Image model you selected."}</p>
        {modelWarning && <p className="training-tip">{modelWarning}</p>}
        {preview && <div className="training-confirmation">
          <div className="training-confirm-grid">
            <span><small>Architecture</small><strong>{preview.architecture === "krea2" ? "Krea 2" : "Z-Image"}</strong></span>
            <span><small>Training base</small><strong>{preview.trainingBase}</strong></span>
            <span><small>Target model</small><strong title={preview.targetModel}>{preview.targetModel.replace(/\.safetensors$/i, "")}</strong></span>
            <span><small>Working disk estimate</small><strong>~{preview.estimatedWorkingGb} GB</strong></span>
          </div>
          <p><AlertTriangle/> {preview.vramProfile}</p>
        </div>}
      </section>
      <section className="training-step">
        <div className="section-title"><span>3. Quality preset</span></div>
        <div className="training-presets">{Object.entries(presets).map(([key, item]) =>
          <button key={key} className={preset === key ? "active" : ""} onClick={() => setPreset(key as keyof typeof presets)}>
            <strong>{item.label}</strong><span>{item.resolution}px · {item.steps} steps · rank {item.rank}</span>
          </button>)}</div>
        <p className="training-tip">{setting.description} Batch size is fixed at 1 with an effective batch of 4.</p>
        {preview && <details className="training-command-preview">
          <summary>Review exact local configuration and commands</summary>
          <pre>{JSON.stringify(preview.config, null, 2)}</pre>
          {preview.commands.map(command => <div key={command.phase}><strong>{command.phase}</strong><code>{command.command}</code></div>)}
        </details>}
        <label className="training-approval"><input type="checkbox" checked={confirmed} disabled={!preview} onChange={event => setConfirmed(event.target.checked)}/><span>I’ve reviewed the architecture, training base, storage estimate, and settings.</span></label>
      </section>
      <div className="training-readiness"><strong>Ready to train</strong>{readiness.map(item => <span className={item.ready ? "ready" : ""} key={item.text}>{item.ready ? <Check/> : <span/>}{item.text}</span>)}</div>
      <div className="training-start-dock"><button className="generate training-start" disabled={!canStart} onClick={start}>
        {submitting || active ? <LoaderCircle className="spin"/> : <Play/>}
        <span>{active ? "Training in progress" : "Start LoRA training"}</span>
      </button><small>{active ? "One local training job runs at a time." : canStart ? `${pictures.length} pictures · ${setting.steps} steps · ${setting.rank} rank` : "Complete the checklist above to continue."}</small></div>
    </aside>

    <section className="training-dataset">
      <div className="training-heading"><div><span>TRAINING PICTURES</span><h2>{pictures.length} picture{pictures.length === 1 ? "" : "s"}</h2><small>{captioned}/{pictures.length} captioned · 3 minimum, 12–30 recommended for a character</small></div><div>
        <input ref={filesInput} hidden type="file" accept="image/png,image/jpeg,image/webp" multiple onChange={event => addPictures(event.target.files)}/>
        <input ref={folderInput} hidden type="file" accept="image/png,image/jpeg,image/webp" multiple {...({ webkitdirectory: "" } as any)} onChange={event => addPictures(event.target.files)}/>
        <button onClick={() => filesInput.current?.click()}><ImagePlus/>Add pictures</button>
        <button onClick={() => folderInput.current?.click()}><FolderOpen/>Choose folder</button>
      </div></div>
      <div className="dataset-guidance">
        <strong>Picture guide</strong>
        <span>Character: 12–30 varied images</span>
        <span>Style: 30–100 images</span>
        <span>Mix angles, framing, lighting, and backgrounds. Remove identity drift, duplicates, and blur.</span>
      </div>
      {pictures.length ? <><div className="training-picture-actions"><span>{pictures.length} in this draft</span><div><button onClick={fillEmptyCaptions} disabled={!trigger.trim() || captioned === pictures.length}>Fill empty captions</button><button className="danger" onClick={clearPictures}><Trash2/>Remove all</button></div></div><div className="training-grid">{pictures.map((picture, index) => <article key={picture.id}>
        <img src={picture.preview} alt={`Training ${index + 1}`}/>
        <button className="remove-training-image" onClick={() => { URL.revokeObjectURL(picture.preview); setPictures(current => current.filter(item => item.id !== picture.id)); }} aria-label={`Remove picture ${index + 1}`}><Trash2/></button>
        <div className="training-picture-meta"><strong>Picture {index + 1}</strong><small title={picture.file.name}>{picture.file.name}</small></div>
        <label>Training caption<textarea value={picture.caption} placeholder={trigger || "Describe the subject or style"} onChange={event => setPictures(current => current.map(item => item.id === picture.id ? { ...item, caption: event.target.value } : item))}/></label>
      </article>)}</div></> : <div className="training-drop"><Upload/><h3>Add a folder or select pictures</h3><p>PNG, JPEG, and WebP are supported. Captions begin with your trigger phrase and remain editable per picture.</p></div>}
    </section>

    <aside className="training-history">
      <div className="section-title"><span><Layers3/> Training history</span></div>
      {jobs.map(job => <article key={job.id}>
        <div className="training-job-head"><strong>{job.name}</strong><span className={`training-state ${job.status}`}>{job.status}</span></div>
        <small>{job.imageCount} pictures · {job.resolution}px · rank {job.rank}</small>
        {["pending", "active"].includes(job.status) && <><div className="progress"><i style={{ width: `${Math.max(3, job.progress || 0)}%` }}/></div><small>{job.progress || 0}% · {job.phase || `${job.steps} steps`}{(job.telemetry?.progress?.currentStep || job.currentStep) ? ` · step ${job.telemetry?.progress?.currentStep || job.currentStep}/${job.steps}` : ""}</small>
          <div className="training-telemetry">
            <span><Activity/><small>GPU</small><strong>{job.telemetry?.gpu ? `${job.telemetry.gpu.utilizationPercent}%` : "Unavailable"}</strong>{job.telemetry?.gpu && <em>{(job.telemetry.gpu.memoryUsedMb / 1024).toFixed(1)} / {(job.telemetry.gpu.memoryTotalMb / 1024).toFixed(1)} GB</em>}</span>
            <span><Cpu/><small>CPU</small><strong>{job.telemetry?.cpuPercent == null ? "Calculating…" : `${job.telemetry.cpuPercent}%`}</strong><em>System usage</em></span>
            <span><Clock3/><small>Time left</small><strong>{formatDuration(job.telemetry?.etaSeconds)}</strong><em>Elapsed {formatDuration(job.telemetry?.elapsedSeconds)}</em></span>
            <span><Gauge/><small>Speed</small><strong>{job.telemetry?.secondsPerIteration ? `${Math.round(job.telemetry.secondsPerIteration)} sec/it` : "Calculating…"}</strong><em>{job.telemetry?.progress ? `${job.telemetry.progress.percent}% of training steps` : "Waiting for steps"}</em></span>
          </div>
          <button className="use-lora" disabled={cancelling === job.id} onClick={() => cancel(job.id)}>{cancelling === job.id ? "Stopping…" : "Cancel training"}</button></>}
        {logs[job.id] && <details className="training-log"><summary>Local trainer log</summary><pre>{logs[job.id]}</pre></details>}
        {job.error && <p className="training-error">{job.error}</p>}
        {job.status === "completed" && <><p className="training-complete"><Check/>Installed as {job.installedName}</p><small>Recommended starting strength: {job.recommendedStrength ?? 1}</small><button className="use-lora" onClick={() => job.installedName && onUse(job.installedName)}>Use in Photo mode</button></>}
      </article>)}
      {!jobs.length && <div className="training-history-empty"><Layers3/><p>Your trained LoRAs will appear here.</p></div>}
    </aside>
  </div>;
}
