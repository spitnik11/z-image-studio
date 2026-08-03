import React, { useEffect, useRef, useState } from "react";
import { AlertTriangle, Check, ChevronLeft, ChevronRight, Download, FolderOpen, ImagePlus, Images, LoaderCircle, Maximize2, Play, RefreshCw, ScanSearch, Sparkles, Trash2, X } from "lucide-react";

type ModelItem = { name: string; architecture: "z-image" | "krea2" | "illustrious" | "anima" | "unknown" };
type DatasetJob = {
  id: string; name: string; trigger: string; model: string; status: string; progress: number;
  phase?: string; count: number; images: string[]; warning?: string; error?: string;
  characterAdjustments?: CharacterAdjustments;
};
type CharacterAdjustments = { hair: string; body: string; other: string };
export type DatasetPresetHandoff = { name:string;architecture:"z-image"|"krea2";characterDescription:string;masterReference:string;additionalImages:string[];note:string };
type ReviewState = "keep" | "reject" | "uncertain";
type Caption = {
  triggerToken: string; stableIdentity: string; expression: string; pose: string; cameraFraming: string;
  cameraAngle: string; clothing: string; background: string; lighting: string; style: string; customText: string;
};
type ReviewItem = { image: string; state: ReviewState; warningTags: string[]; caption: Caption; renderedCaption: string; analysis?: { width: number; height: number; blurScore: number } };
type Review = { items: ReviewItem[] };
type CharacterProfile = { id: string; name: string; triggerToken: string; stableIdentity: string; hairstyle: string; eyeColor: string; bodyCharacteristics: string; defaultOutfit: string; preferredModel: string; masterReferenceImages: string[] };
const warningOptions = ["face-drift","bad-hands","anatomy","text-watermark","incorrect-identity","blur","poor-crop","low-resolution","exact-duplicate","near-duplicate"];
const captionLabels: Record<keyof Caption, string> = {
  triggerToken: "Trigger token", stableIdentity: "Stable identity", expression: "Expression",
  pose: "Pose", cameraFraming: "Camera framing", cameraAngle: "Camera angle",
  clothing: "Clothing", background: "Background", lighting: "Lighting", style: "Style",
  customText: "Identity / custom details"
};
const matrixOptions = {
  angles: ["front","three-quarter","profile","back three-quarter"],
  framings: ["close-up headshot","waist-up","three-quarter body","full-body"],
  expressions: ["neutral","smiling","angry","surprised","thoughtful"],
  poses: ["standing","walking","sitting","simple action"],
  scenes: ["studio","indoor","outdoor"],
  lighting: ["soft daylight","evening light","backlit"]
};

export function DatasetBuilder({ models, onTrain, onExit, presetHandoff }: {
  models: ModelItem[]; onTrain: (id: string) => void; onExit: () => void; presetHandoff?:DatasetPresetHandoff;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [master, setMaster] = useState<File>();
  const [preview, setPreview] = useState("");
  const [name, setName] = useState("");
  const [trigger, setTrigger] = useState("");
  const [basePrompt, setBasePrompt] = useState("photorealistic adult character, consistent hairstyle and outfit");
  const [model, setModel] = useState("");
  const [count, setCount] = useState(40);
  const [jobs, setJobs] = useState<DatasetJob[]>([]);
  const [notice, setNotice] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [profiles, setProfiles] = useState<CharacterProfile[]>([]);
  const [characterProfileId, setCharacterProfileId] = useState("");
  const [captionStrategy, setCaptionStrategy] = useState("flexible-character");
  const [matrix, setMatrix] = useState<Record<keyof typeof matrixOptions, string[]>>(() => Object.fromEntries(Object.entries(matrixOptions).map(([key, values]) => [key, [...values]])) as any);
  const [varyOutfits, setVaryOutfits] = useState(true);
  const [varyBackgrounds, setVaryBackgrounds] = useState(true);
  const [characterAdjustments, setCharacterAdjustments] = useState<CharacterAdjustments>({ hair: "", body: "", other: "" });
  const [presetMaster,setPresetMaster]=useState("");
  const [reviewJob, setReviewJob] = useState<DatasetJob>();
  const active = submitting || jobs.some(job => ["pending", "active", "paused"].includes(job.status));

  async function refresh() {
    const response = await fetch("/api/datasets");
    if (!response.ok) throw new Error("Could not load datasets.");
    setJobs(await response.json());
  }
  useEffect(() => {
    setModel(current => current || models.find(item => item.architecture === "krea2")?.name || models.find(item => item.architecture === "z-image")?.name || "");
  }, [models]);
  useEffect(()=>{
    if(!presetHandoff)return;
    setName(presetHandoff.name);setBasePrompt(presetHandoff.characterDescription);setPresetMaster(presetHandoff.masterReference);
    setModel(models.find(item=>item.architecture===presetHandoff.architecture)?.name||"");
    setNotice(`${presetHandoff.note} Add a trigger phrase, review the settings, then build when ready.`);
  },[presetHandoff,models]);
  useEffect(() => {
    refresh().catch(error => setNotice(error.message));
    fetch("/api/characters").then(response => response.json()).then(setProfiles).catch(() => {});
    const timer = window.setInterval(() => refresh().catch(() => {}), 4000);
    return () => window.clearInterval(timer);
  }, []);

  function choose(file?: File) {
    if (preview) URL.revokeObjectURL(preview);
    setMaster(file);
    if(file)setPresetMaster("");
    setPreview(file ? URL.createObjectURL(file) : "");
  }
  function selectProfile(id: string) {
    setCharacterProfileId(id);
    if(id)setPresetMaster("");
    const profile = profiles.find(value => value.id === id);
    if (!profile) return;
    setName(current => current || `${profile.name} dataset`);
    setTrigger(profile.triggerToken);
    setBasePrompt([profile.stableIdentity, profile.hairstyle && `${profile.hairstyle} hair`, profile.eyeColor && `${profile.eyeColor} eyes`, profile.bodyCharacteristics, profile.defaultOutfit].filter(Boolean).join(", "));
    if (profile.preferredModel && models.some(value => value.name === profile.preferredModel)) setModel(profile.preferredModel);
  }
  async function build() {
    setNotice("");
    const profile = profiles.find(value => value.id === characterProfileId);
    if ((!master && !presetMaster && !profile?.masterReferenceImages?.length) || !name.trim() || !trigger.trim() || !model) return setNotice("Choose a master image or saved character reference, plus a dataset name, trigger phrase, and image model.");
    setSubmitting(true);
    setNotice(`Preparing ${count} labelled images…`);
    const body = new FormData();
    if (master) body.append("master", master);
    body.append("config", JSON.stringify({ name, trigger, model, basePrompt, masterReference:presetMaster||undefined, characterAdjustments, count, width: 512, height: 768, seed: 42, characterProfileId: characterProfileId || undefined, captionStrategy, promptMatrix: { ...matrix, varyOutfits, varyBackgrounds } }));
    try {
      const response = await fetch("/api/datasets", { method: "POST", body });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Dataset generation could not start.");
      setJobs(current => [payload, ...current.filter(job => job.id !== payload.id)]);
      setNotice(`${count} images queued. Progress is now shown in Dataset history.`);
    } catch (error: any) {
      setNotice(error.message || "Dataset generation could not start.");
    } finally {
      setSubmitting(false);
    }
  }
  async function deleteDataset(job: DatasetJob) {
    if (!window.confirm(`Delete “${job.name}” and all of its local dataset images, captions, reviews, and exports? This cannot be undone.`)) return;
    setNotice(`Deleting ${job.name}…`);
    try {
      const response = await fetch(`/api/datasets/${job.id}`, { method: "DELETE" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Dataset could not be deleted.");
      setJobs(current => current.filter(item => item.id !== job.id));
      if (reviewJob?.id === job.id) setReviewJob(undefined);
      setNotice(`${job.name} was deleted.`);
    } catch (error: any) {
      setNotice(error.message || "Dataset could not be deleted.");
      void refresh();
    }
  }
  async function recoverDataset(job: DatasetJob) {
    setNotice(`Checking interrupted images in ${job.name}…`);
    try {
      const response = await fetch(`/api/datasets/${job.id}/resume`, { method: "POST" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Dataset recovery could not start.");
      setJobs(current => current.map(item => item.id === payload.id ? payload : item));
      setNotice(`${job.name} is recovering. Completed images have been kept.`);
    } catch (error: any) {
      setNotice(error.message || "Dataset recovery could not start.");
      void refresh();
    }
  }

  return <div className="dataset-builder-workspace">
    <nav className="training-nav"><button onClick={onExit}>← Back to Photo mode</button><span>Dataset Builder</span></nav>
    <aside className="dataset-builder-panel">
      <div className="eyebrow">CHARACTER DATASET</div>
      <h1>Turn one character into a training set</h1>
      <p className="intro">Creates labelled headshots, medium shots, full-body views, and varied poses while keeping the master character as the identity guide.</p>
      {notice && <p className="training-notice">{notice}</p>}
      <label>Saved character<select value={characterProfileId} onChange={event => selectProfile(event.target.value)}><option value="">No saved character</option>{profiles.map(profile => <option value={profile.id} key={profile.id}>{profile.name}</option>)}</select></label>
      <label>Dataset name<input value={name} onChange={event => setName(event.target.value)} placeholder="My character dataset"/></label>
      <label>Trigger phrase<input value={trigger} onChange={event => setTrigger(event.target.value)} placeholder="photo of zperson"/></label>
      <label>Image model<select value={model} onChange={event => setModel(event.target.value)}>
        <option value="">Choose a model</option>
        {models.filter(item => item.architecture === "z-image" || item.architecture === "krea2").map(item => <option key={item.name} value={item.name}>{item.architecture === "krea2" ? "Krea 2 · strongest identity" : "Z-Image · structural reference"} · {item.name}</option>)}
      </select></label>
      <label>Character description<textarea value={basePrompt} onChange={event => setBasePrompt(event.target.value)}/></label>
      <details className="character-adjustments">
        <summary>Character adjustments <span>Optional</span></summary>
        <p>Use these only for deliberate traits the whole dataset should learn. They affect generated images and captions, but do not overwrite the saved Character profile.</p>
        <label>Hair change<input value={characterAdjustments.hair} onChange={event => setCharacterAdjustments(current => ({ ...current, hair: event.target.value }))} placeholder="e.g. shoulder-length copper-red hair"/></label>
        <label>Body proportions<input value={characterAdjustments.body} onChange={event => setCharacterAdjustments(current => ({ ...current, body: event.target.value }))} placeholder="e.g. tall, athletic build with broad shoulders"/></label>
        <label>Other stable change<textarea value={characterAdjustments.other} onChange={event => setCharacterAdjustments(current => ({ ...current, other: event.target.value }))} placeholder="Only traits that should remain consistent across this dataset"/></label>
        <div className="adjustment-advice"><AlertTriangle/><span>For temporary outfit, pose, expression, or scene changes, use Prompt variety instead. Mixing unlabelled identity changes can weaken a LoRA.</span></div>
      </details>
      <label>Dataset size<select value={count} onChange={event => setCount(Number(event.target.value))}><option value={12}>12 · test</option><option value={24}>24 · compact</option><option value={40}>40 · complete</option></select></label>
      <label>Caption strategy<select value={captionStrategy} onChange={event => setCaptionStrategy(event.target.value)}><option value="identity-focused">Identity-focused</option><option value="flexible-character">Flexible character</option><option value="outfit-concept">Outfit / concept</option><option value="style">Style</option><option value="custom">Custom</option></select></label>
      <details className="prompt-matrix"><summary><span>Prompt variety</span><em>40-shot directed sequence</em></summary><p className="prompt-matrix-note">Defaults step through 40 distinct poses with ordered framing, camera angles, expressions, scenes, and lighting. Narrowing a category below overrides that part of the sequence.</p>{(Object.keys(matrixOptions) as (keyof typeof matrixOptions)[]).map(key => <MultiToggle key={key} label={key} values={matrixOptions[key]} selected={matrix[key]} onChange={values => setMatrix(current => ({ ...current, [key]: values }))}/>)}
        <label className="matrix-check"><input type="checkbox" checked={varyOutfits} onChange={event => setVaryOutfits(event.target.checked)}/>Vary outfits</label>
        <label className="matrix-check"><input type="checkbox" checked={varyBackgrounds} onChange={event => setVaryBackgrounds(event.target.checked)}/>Vary backgrounds</label>
      </details>
      <button className="generate training-start" disabled={active} onClick={build}>{active ? <LoaderCircle className="spin"/> : <Play/>}<span>{submitting ? "Preparing dataset…" : active ? "Building dataset" : `Generate ${count} labelled images`}</span></button>
    </aside>
    {reviewJob ? <DatasetReview job={reviewJob} onClose={() => setReviewJob(undefined)} onTrain={() => onTrain(reviewJob.id)} onRecordChanged={record => {
      setJobs(current => current.map(item => item.id === record.id ? record : item));
      setReviewJob(record);
    }} onExtended={record => {
      setJobs(current => current.map(item => item.id === record.id ? record : item));
      setReviewJob(undefined);
    }} setNotice={setNotice}/> : <section className="dataset-master">
      <div className="training-heading"><div><span>MASTER CHARACTER</span><h2>Identity reference</h2></div><button onClick={() => input.current?.click()}><FolderOpen/>Choose image</button></div>
      <input ref={input} hidden type="file" accept="image/png,image/jpeg,image/webp" onChange={event => choose(event.target.files?.[0])}/>
      {preview ? <img className="dataset-master-image" src={preview} alt="Master character"/> : <div className="training-drop"><Sparkles/><h3>Choose your clearest character image</h3><p>Use a sharp, unobstructed face with neutral lighting. A waist-up or full-body source gives the generator more identity and clothing information.</p></div>}
      <div className="dataset-guidance"><strong>Directed variety plan</strong><span>40 distinct pose and action slots</span><span>Ordered close-up, medium, seated, and full-body coverage</span><span>Extensions continue from the next unused slot instead of restarting</span></div>
    </section>}
    <aside className="training-history">
      {reviewJob ? <div className="review-checklist"><div className="section-title"><span><Check/> Before training</span></div><ol><li><strong>Review every image</strong><span>Keep strong identity matches. Remove drift, anatomy problems, and duplicates from training.</span></li><li><strong>Check captions</strong><span>Caption edits save automatically and follow each kept image into LoRA Lab.</span></li><li><strong>Add anything missing</strong><span>New local images enter as Unsure so they cannot train until you approve them.</span></li><li><strong>Continue with kept images</strong><span>At least 3 are required; 12–30 varied, high-quality images are recommended.</span></li></ol></div> : <><div className="section-title history-title"><span><Images/> Dataset history</span><button onClick={() => refresh().then(() => setNotice("Dataset history refreshed.")).catch(error => setNotice(error.message))} aria-label="Refresh dataset history"><RefreshCw/>Refresh</button></div>
      {jobs.map(job => <article key={job.id}>
        <div className="training-job-head"><strong>{job.name}</strong><span className={`training-state ${job.status}`}>{job.status}</span></div>
        <small>{job.status === "completed" ? `${job.images?.length || 0} images` : `${job.images?.length || 0}/${job.count} images`} · {job.phase}</small>
        {["pending", "active", "paused"].includes(job.status) && <div className="progress"><i style={{ width: `${Math.max(3, job.progress || 0)}%` }}/></div>}
        {job.warning && <p className="training-tip">{job.warning}</p>}
        {job.error && <p className="training-error">{job.error}</p>}
        {job.status === "completed" && <p className="training-complete"><Check/>Ready to review before training</p>}
        <div className="dataset-history-actions">
          {job.status === "completed" && <button className="use-lora" onClick={() => setReviewJob(job)}>Review dataset</button>}
          {job.status === "failed" && <button className="recover-dataset" onClick={() => recoverDataset(job)}><RefreshCw/>Recover</button>}
          <button className="delete-dataset" disabled={["pending", "active", "paused"].includes(job.status)} onClick={() => deleteDataset(job)}><Trash2/>Delete</button>
        </div>
      </article>)}
      {!jobs.length && <div className="training-history-empty"><Images/><p>Generated datasets will appear here.</p></div>}</>}
    </aside>
  </div>;
}

function MultiToggle({ label, values, selected, onChange }: { label: string; values: string[]; selected: string[]; onChange: (values: string[]) => void }) {
  return <fieldset className="matrix-group"><legend>{label}</legend>{values.map(value => <label key={value}><input type="checkbox" checked={selected.includes(value)} onChange={() => {
    const next = selected.includes(value) ? selected.filter(item => item !== value) : [...selected, value];
    if (next.length) onChange(next);
  }}/>{value}</label>)}</fieldset>;
}

function DatasetReview({ job, onClose, onTrain, onExtended, onRecordChanged, setNotice }: { job: DatasetJob; onClose: () => void; onTrain: () => void; onExtended: (record: DatasetJob) => void; onRecordChanged: (record: DatasetJob) => void; setNotice: (value: string) => void }) {
  const addInput = useRef<HTMLInputElement>(null);
  const [review, setReview] = useState<Review>();
  const [selected, setSelected] = useState(0);
  const [checked, setChecked] = useState<string[]>([]);
  const [filter, setFilter] = useState<ReviewState | "all">("all");
  const [busy, setBusy] = useState("");
  const [exportPath, setExportPath] = useState("");
  const [saveState, setSaveState] = useState<"saved" | "unsaved" | "saving" | "error">("saved");
  const [localNotice, setLocalNotice] = useState("");
  const [showExtend, setShowExtend] = useState(false);
  const [extendMode, setExtendMode] = useState<"to40" | "custom">("to40");
  const [extendCount, setExtendCount] = useState(8);
  const [extendAdjustments, setExtendAdjustments] = useState<CharacterAdjustments>(job.characterAdjustments || { hair: "", body: "", other: "" });
  const [lightbox, setLightbox] = useState(false);
  const [lightboxRatio, setLightboxRatio] = useState(2 / 3);
  const visible = (review?.items || []).filter(item => filter === "all" || item.state === filter);
  const item = visible[Math.min(selected, Math.max(0, visible.length - 1))];
  const allVisibleChecked = visible.length > 0 && visible.every(candidate => checked.includes(candidate.image));
  useEffect(() => {
    if (!lightbox || !item?.analysis?.width || !item.analysis.height) return;
    setLightboxRatio(item.analysis.width / item.analysis.height);
  }, [lightbox, item?.image, item?.analysis?.width, item?.analysis?.height]);

  async function load(showFeedback = false) {
    const response = await fetch(`/api/datasets/${job.id}/review`);
    if (!response.ok) throw new Error("Could not load dataset review.");
    setReview(await response.json());
    if (showFeedback) setLocalNotice("Review refreshed with the latest dataset changes.");
  }
  useEffect(() => { load().catch(error => setNotice(error.message)); }, [job.id]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if ((event.target as HTMLElement)?.matches("input,textarea")) return;
      if (event.key === "Escape" && lightbox) return setLightbox(false);
      if (event.key === "ArrowRight") setSelected(value => Math.min(visible.length - 1, value + 1));
      if (event.key === "ArrowLeft") setSelected(value => Math.max(0, value - 1));
      if (event.key.toLowerCase() === "k" && item) void save([{ image: item.image, state: "keep" }]);
      if (event.key.toLowerCase() === "r" && item) void save([{ image: item.image, state: "reject" }]);
      if (event.key.toLowerCase() === "u" && item) void save([{ image: item.image, state: "uncertain" }]);
    };
    window.addEventListener("keydown", key); return () => window.removeEventListener("keydown", key);
  }, [item?.image, visible.length, lightbox]);

  async function save(updates: Record<string, unknown>[]) {
    setSaveState("saving");
    try {
      const response = await fetch(`/api/datasets/${job.id}/review`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ updates }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Review changes could not be saved.");
      setReview(payload);
      setSaveState("saved");
      return true;
    } catch (error: any) {
      setSaveState("error");
      setNotice(error.message);
      return false;
    }
  }
  function state(value: ReviewState) {
    const images = checked.length ? checked : item ? [item.image] : [];
    void save(images.map(image => ({ image, state: value })));
    setChecked([]);
  }
  async function analyze() {
    setBusy("Checking"); setNotice("");
    const response = await fetch(`/api/datasets/${job.id}/analyze`, { method: "POST" });
    const payload = await response.json();
    setBusy("");
    if (!response.ok) return setNotice(payload.error || "Image checks failed.");
    setReview(payload);
  }
  async function exportSet() {
    setBusy("Exporting"); setNotice("");
    const response = await fetch(`/api/datasets/${job.id}/export`, { method: "POST" });
    const payload = await response.json();
    setBusy("");
    if (!response.ok) return setNotice(payload.error || "Dataset export failed.");
    setExportPath(payload.path);
  }
  function caption(field: keyof Caption, value: string) {
    if (!review || !item) return;
    const next = { ...item.caption, [field]: value };
    setReview({ ...review, items: review.items.map(candidate => candidate.image === item.image ? { ...candidate, caption: next } : candidate) });
    setSaveState("unsaved");
  }
  useEffect(() => {
    if (saveState !== "unsaved" || !item) return;
    const image = item.image;
    const nextCaption = item.caption;
    const timer = window.setTimeout(() => { void save([{ image, caption: nextCaption }]); }, 650);
    return () => window.clearTimeout(timer);
  }, [saveState, item?.image, item?.caption]);
  async function addImages(files: FileList | null) {
    const selectedFiles = Array.from(files || []);
    if (!selectedFiles.length) return;
    setBusy("Adding"); setLocalNotice("");
    const body = new FormData();
    selectedFiles.forEach(file => body.append("images", file));
    body.append("captions", JSON.stringify(selectedFiles.map(() => job.trigger)));
    try {
      const response = await fetch(`/api/datasets/${job.id}/images`, { method: "POST", body });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Images could not be added.");
      setReview(payload.review);
      setFilter("all");
      setSelected(Math.max(0, payload.review.items.length - selectedFiles.length));
      setLocalNotice(`${selectedFiles.length} image${selectedFiles.length === 1 ? "" : "s"} added as Unsure. Review captions and mark Keep before training.`);
    } catch (error: any) { setNotice(error.message); }
    finally {
      setBusy("");
      if (addInput.current) addInput.current.value = "";
    }
  }
  async function extendDataset() {
    const currentTotal = review?.items.length || job.images?.length || 0;
    const requested = extendMode === "to40" ? Math.max(0, 40 - currentTotal) : extendCount;
    if (requested < 1) return setLocalNotice("This dataset already contains 40 or more images. Choose a specific additional amount instead.");
    setBusy("Generating"); setLocalNotice("");
    try {
      const response = await fetch(`/api/datasets/${job.id}/extend`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ count: requested, characterAdjustments: extendAdjustments })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "More dataset images could not be queued.");
      setNotice(`${requested} more image${requested === 1 ? "" : "s"} queued for ${job.name}. They will enter review as Unsure when complete.`);
      onExtended(payload);
    } catch (error: any) {
      setLocalNotice(error.message);
      setBusy("");
    }
  }
  async function deleteImage(target: ReviewItem) {
    if (!window.confirm(`Permanently delete ${target.image} from this dataset? Its image file, caption, and review entry will be removed.`)) return;
    setBusy("Deleting"); setLocalNotice(`Deleting ${target.image}…`);
    try {
      const response = await fetch(`/api/datasets/${job.id}/images/${encodeURIComponent(target.image)}`, { method: "DELETE" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Image could not be deleted.");
      setReview(payload.review);
      setChecked(current => current.filter(name => name !== target.image));
      const nextVisible = payload.review.items.filter((candidate: ReviewItem) => filter === "all" || candidate.state === filter);
      setSelected(current => Math.max(0, Math.min(current, nextVisible.length - 1)));
      if (!nextVisible.length) setLightbox(false);
      setLocalNotice(`${target.image} was permanently deleted. The collection now contains ${payload.review.items.length} images.`);
      onRecordChanged(payload.record);
    } catch (error: any) {
      setLocalNotice(error.message || "Image could not be deleted.");
      await load(true).catch(() => {});
    } finally {
      setBusy("");
    }
  }
  function toggleWarning(tag: string) {
    if (!item) return;
    const warningTags = item.warningTags.includes(tag) ? item.warningTags.filter(value => value !== tag) : [...item.warningTags, tag];
    void save([{ image: item.image, warningTags }]);
  }
  const counts = review?.items.reduce((result, value) => ({ ...result, [value.state]: result[value.state] + 1 }), { keep: 0, reject: 0, uncertain: 0 } as Record<ReviewState, number>);
  const statistics = review ? (["cameraFraming","cameraAngle","expression","pose","clothing","background","lighting"] as (keyof Caption)[]).map(field => {
    const values = review.items.reduce((result, value) => {
      const tag = value.caption[field]?.trim();
      if (tag) result[tag] = (result[tag] || 0) + 1;
      return result;
    }, {} as Record<string, number>);
    return { field, values };
  }) : [];

  const keptCount = counts?.keep || 0;
  return <section className="dataset-review">
    <div className="training-heading dataset-review-heading"><div><span>DATASET REVIEW</span><h2>{job.name}</h2><small>{review?.items.length || 0} total · {keptCount} ready for training</small></div><div><button onClick={() => load(true).catch(error => setNotice(error.message))}><RefreshCw/>Refresh</button><button onClick={onClose}>Close review</button><button className="review-train" disabled={keptCount < 3 || saveState !== "saved"} onClick={onTrain}>Continue with {keptCount} kept</button></div></div>
    <div className="review-save-state" data-state={saveState}>{saveState === "saving" ? "Saving changes…" : saveState === "unsaved" ? "Changes pending…" : saveState === "error" ? "Save needs attention" : "All changes saved automatically"}</div>
    <section className={`dataset-extend ${showExtend ? "open" : ""}`}>
      <button className="dataset-extend-toggle" onClick={() => setShowExtend(value => !value)}><Sparkles/><span><strong>Generate more images</strong><small>Fill this dataset to 40, or choose exactly how many to add.</small></span><b>{showExtend ? "Close" : "Open"}</b></button>
      {showExtend && <div className="dataset-extend-body">
        <div className="extend-mode">
          <button className={extendMode === "to40" ? "active" : ""} onClick={() => setExtendMode("to40")}><strong>Fill to 40</strong><small>Add {Math.max(0, 40 - (review?.items.length || 0))} images</small></button>
          <button className={extendMode === "custom" ? "active" : ""} onClick={() => setExtendMode("custom")}><strong>Add a specific amount</strong><small>Choose 1–40 more</small></button>
        </div>
        {extendMode === "custom" && <label className="extend-count">Additional images<input type="number" min={1} max={40} value={extendCount} onChange={event => setExtendCount(Math.max(1, Math.min(40, Number(event.target.value) || 1)))}/></label>}
        <details className="extend-adjustments">
          <summary>Adjust character traits for the new images <span>Optional</span></summary>
          <p>Keep these consistent with the existing set unless you intentionally want the LoRA to learn the changed trait.</p>
          <div>
            <label>Hair change<input value={extendAdjustments.hair} onChange={event => setExtendAdjustments(current => ({ ...current, hair: event.target.value }))}/></label>
            <label>Body proportions<input value={extendAdjustments.body} onChange={event => setExtendAdjustments(current => ({ ...current, body: event.target.value }))}/></label>
            <label className="wide">Other stable change<textarea value={extendAdjustments.other} onChange={event => setExtendAdjustments(current => ({ ...current, other: event.target.value }))}/></label>
          </div>
        </details>
        <button className="generate-more-confirm" disabled={!!busy || (extendMode === "to40" && (review?.items.length || 0) >= 40)} onClick={extendDataset}>{busy === "Generating" ? <LoaderCircle className="spin"/> : <Play/>}{busy === "Generating" ? "Queuing images…" : extendMode === "to40" ? `Generate ${Math.max(0, 40 - (review?.items.length || 0))} to reach 40` : `Generate ${extendCount} more`}</button>
      </div>}
    </section>
    <div className="review-toolbar">
      {(["all","keep","uncertain","reject"] as const).map(value => <button className={filter === value ? "active" : ""} onClick={() => { setFilter(value); setSelected(0); setChecked([]); }} key={value}>{value} {value !== "all" && counts ? counts[value] : ""}</button>)}
      <button className={`select-all-review ${allVisibleChecked ? "active" : ""}`} aria-pressed={allVisibleChecked} disabled={!visible.length} onClick={() => setChecked(allVisibleChecked ? [] : visible.map(candidate => candidate.image))}>
        <Check/>{allVisibleChecked ? `Clear selected (${checked.length})` : `Select all ${visible.length}`}
      </button>
      <input ref={addInput} hidden type="file" multiple accept="image/png,image/jpeg,image/webp" onChange={event => addImages(event.target.files)}/>
      <button onClick={() => addInput.current?.click()} disabled={!!busy}><ImagePlus/>{busy === "Adding" ? "Adding…" : "Add images"}</button>
      <button onClick={analyze} disabled={!!busy}><ScanSearch/>{busy === "Checking" ? "Checking…" : "Run quality checks"}</button>
      <button onClick={exportSet} disabled={!!busy}><Download/>Export kept images</button>
    </div>
    {localNotice && <p className="review-local-notice">{localNotice}</p>}
    {exportPath && <p className="review-export">Export ready at <code>{exportPath}</code></p>}
    {!review ? <div className="training-drop"><LoaderCircle className="spin"/><p>Loading review…</p></div> : !item ? <div className="training-drop"><Images/><p>No images match this filter.</p></div> : <>
      <div className="review-main">
        <div className="review-preview">
          <img src={`/api/datasets/${job.id}/images/${encodeURIComponent(item.image)}`} alt={item.image}/>
          <div><strong>{item.image}</strong>{item.analysis && <span>{item.analysis.width}×{item.analysis.height} · sharpness {item.analysis.blurScore}</span>}<span className="preview-image-actions"><button onClick={() => setLightbox(true)}><Maximize2/>Enlarge</button><button className="delete-image" disabled={!!busy} onClick={() => deleteImage(item)}><Trash2/>Delete image</button></span></div>
        </div>
        <div className="review-editor">
          <div className="review-state-buttons"><button className={item.state === "keep" ? "active keep" : ""} onClick={() => state("keep")}><Check/>Keep for training (K)</button><button className={item.state === "uncertain" ? "active uncertain" : ""} onClick={() => state("uncertain")}><AlertTriangle/>Unsure (U)</button><button className={item.state === "reject" ? "active reject" : ""} onClick={() => state("reject")}><X/>Remove from training (R)</button></div>
          <h3>Review warnings</h3><div className="warning-tags">{warningOptions.map(tag => <button className={item.warningTags.includes(tag) ? "active" : ""} onClick={() => toggleWarning(tag)} key={tag}>{tag.replaceAll("-", " ")}</button>)}</div>
          <h3>Structured caption</h3>
          <div className="caption-fields">
            {(["triggerToken","expression","pose","cameraFraming","cameraAngle","clothing","background","lighting","style"] as (keyof Caption)[]).map(field => <label key={field}>{captionLabels[field]}<input value={item.caption[field]} onChange={event => caption(field, event.target.value)}/></label>)}
            <label className="wide">Identity / custom details<textarea value={item.caption.customText} onChange={event => caption("customText", event.target.value)}/></label>
          </div>
          <div className="caption-preview-wrap"><small>Training caption · saves automatically</small><p className="caption-preview">{item.renderedCaption}</p></div>
        </div>
      </div>
      <div className="review-thumbnails">{visible.map((candidate, index) => <article className={`${candidate.state} ${candidate.image === item.image ? "active" : ""}`} key={candidate.image}>
        <input type="checkbox" checked={checked.includes(candidate.image)} onChange={() => setChecked(value => value.includes(candidate.image) ? value.filter(name => name !== candidate.image) : [...value, candidate.image])}/>
        <button onClick={() => { setSelected(index); setLightbox(true); }}><img src={`/api/datasets/${job.id}/images/${encodeURIComponent(candidate.image)}`} alt=""/><span>{candidate.warningTags.length ? `⚠ ${candidate.warningTags.length}` : candidate.state}</span></button>
      </article>)}</div>
      <details className="dataset-statistics"><summary>Dataset statistics</summary><div>{statistics.map(stat => <section key={stat.field}><strong>{stat.field.replace(/([A-Z])/g, " $1")}</strong>{Object.entries(stat.values).map(([name, total]) => <span key={name}>{name} <b>{total}</b></span>)}</section>)}</div></details>
      {checked.length > 0 && <div className="bulk-review"><strong>{checked.length} selected</strong><button onClick={() => state("keep")}>Keep for training</button><button onClick={() => state("uncertain")}>Mark unsure</button><button onClick={() => state("reject")}>Remove from training</button></div>}
      {lightbox && item && <div className="dataset-lightbox" role="dialog" aria-modal="true" aria-label={`Preview ${item.image}`} onClick={() => setLightbox(false)}>
        <div className="dataset-lightbox-card" style={{ "--lightbox-ratio": lightboxRatio } as React.CSSProperties} onClick={event => event.stopPropagation()}>
          <div className="lightbox-head"><div><strong>{item.image}</strong><small>{selected + 1} of {visible.length} · {item.state}</small></div><button onClick={() => setLightbox(false)} aria-label="Close image preview"><X/></button></div>
          <div className="lightbox-image-wrap"><img src={`/api/datasets/${job.id}/images/${encodeURIComponent(item.image)}`} alt={item.image} onLoad={event => {
            const image = event.currentTarget;
            if (image.naturalWidth && image.naturalHeight) setLightboxRatio(image.naturalWidth / image.naturalHeight);
          }}/></div>
          <div className="lightbox-actions">
            <button disabled={selected <= 0} onClick={() => setSelected(value => Math.max(0, value - 1))}><ChevronLeft/>Previous</button>
            <button className="delete-image" disabled={!!busy} onClick={() => deleteImage(item)}><Trash2/>{busy === "Deleting" ? "Deleting…" : "Delete image"}</button>
            <button disabled={selected >= visible.length - 1} onClick={() => setSelected(value => Math.min(visible.length - 1, value + 1))}>Next<ChevronRight/></button>
          </div>
        </div>
      </div>}
    </>}
  </section>;
}
