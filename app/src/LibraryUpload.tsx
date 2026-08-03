import React, { useCallback, useEffect, useRef, useState } from "react";
import { AlertCircle, Check, LoaderCircle, Upload, X } from "lucide-react";

export type LibraryKind = "lora" | "diffusion" | "checkpoint";

export type LibraryUploadResult = {
  uploaded: Array<{ filename: string; kind: LibraryKind; bytes: number }>;
  models?: unknown[];
  loras?: unknown[];
  discoveryError?: string;
  notice?: string;
};

type Props = {
  /** Called after a successful install so the host can refresh pickers. */
  onSuccess: (result: LibraryUploadResult) => void | Promise<void>;
  /** Surface a short notice in the global banner. */
  onNotice?: (message: string) => void;
  /** Soft-warn when jobs are running; never hard-blocks upload. */
  activeJobCount?: number;
  /** Imperative open from section buttons. */
  openRequest?: { id: number; preferredKind?: LibraryKind } | null;
};

const MAX_CLIENT_BYTES = 20 * 1024 * 1024 * 1024;
const ALLOWED = /\.safetensors$/i;

const KIND_OPTIONS: Array<{ value: LibraryKind; label: string; help: string }> = [
  { value: "lora", label: "LoRA adapter", help: "Installs into lora/ and appears in the LoRA stack after refresh." },
  { value: "diffusion", label: "Diffusion model (UNET)", help: "Installs at the project root for Z-Image / Krea-style models." },
  { value: "checkpoint", label: "Checkpoint (Illustrious / SDXL)", help: "Installs into checkpoints/ for the checkpoint picker." }
];

function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function hasFilePayload(event: DragEvent | React.DragEvent) {
  const types = event.dataTransfer?.types;
  if (!types) return false;
  return Array.from(types as ArrayLike<string>).includes("Files");
}

export function LibraryUpload({ onSuccess, onNotice, activeJobCount = 0, openRequest }: Props) {
  const [dragging, setDragging] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [kind, setKind] = useState<LibraryKind>("lora");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");
  const [doneNames, setDoneNames] = useState<string[]>([]);
  const dragDepth = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const xhrRef = useRef<XMLHttpRequest | null>(null);

  const resetModal = useCallback(() => {
    if (busy) return;
    setModalOpen(false);
    setPendingFiles([]);
    setError("");
    setProgress(0);
    setDoneNames([]);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, [busy]);

  const openWithFiles = useCallback((files: File[], preferred?: LibraryKind) => {
    const list = files.filter(Boolean);
    if (!list.length) return;
    const invalid = list.find(file => !ALLOWED.test(file.name));
    if (invalid) {
      setError(`Only .safetensors files are accepted (${invalid.name}).`);
      setPendingFiles([]);
      setModalOpen(true);
      return;
    }
    const oversized = list.find(file => file.size > MAX_CLIENT_BYTES);
    if (oversized) {
      setError(`${oversized.name} exceeds the 20 GB upload limit.`);
      setPendingFiles([]);
      setModalOpen(true);
      return;
    }
    if (list.some(file => file.size === 0)) {
      setError("Empty files cannot be uploaded.");
      setPendingFiles([]);
      setModalOpen(true);
      return;
    }
    setError("");
    setPendingFiles(list);
    if (preferred) setKind(preferred);
    setModalOpen(true);
  }, []);

  useEffect(() => {
    if (!openRequest) return;
    setKind(openRequest.preferredKind || "lora");
    setError("");
    setPendingFiles([]);
    setModalOpen(true);
    // Prefer letting the user pick files when opened from a button.
    queueMicrotask(() => fileInputRef.current?.click());
  }, [openRequest]);

  useEffect(() => {
    const onEnter = (event: DragEvent) => {
      if (!hasFilePayload(event)) return;
      event.preventDefault();
      dragDepth.current += 1;
      setDragging(true);
    };
    const onOver = (event: DragEvent) => {
      if (!hasFilePayload(event)) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
    };
    const onLeave = (event: DragEvent) => {
      if (!hasFilePayload(event)) return;
      event.preventDefault();
      dragDepth.current = Math.max(0, dragDepth.current - 1);
      if (dragDepth.current === 0) setDragging(false);
    };
    const onDrop = (event: DragEvent) => {
      if (!hasFilePayload(event)) return;
      event.preventDefault();
      dragDepth.current = 0;
      setDragging(false);
      const files = Array.from(event.dataTransfer?.files || []);
      if (files.length) openWithFiles(files);
    };
    window.addEventListener("dragenter", onEnter);
    window.addEventListener("dragover", onOver);
    window.addEventListener("dragleave", onLeave);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragenter", onEnter);
      window.removeEventListener("dragover", onOver);
      window.removeEventListener("dragleave", onLeave);
      window.removeEventListener("drop", onDrop);
    };
  }, [openWithFiles]);

  async function startUpload() {
    if (!pendingFiles.length || busy) return;
    setBusy(true);
    setError("");
    setProgress(0);
    setDoneNames([]);
    try {
      const body = new FormData();
      body.append("kind", kind);
      for (const file of pendingFiles) body.append("files", file, file.name);

      const result = await new Promise<LibraryUploadResult>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhrRef.current = xhr;
        xhr.open("POST", "/api/library/upload");
        xhr.upload.onprogress = event => {
          if (event.lengthComputable) setProgress(Math.round((event.loaded / event.total) * 100));
        };
        xhr.onload = () => {
          let payload: any = {};
          try { payload = JSON.parse(xhr.responseText || "{}"); } catch { payload = {}; }
          if (xhr.status >= 200 && xhr.status < 300) resolve(payload as LibraryUploadResult);
          else reject(new Error(payload.error || `Upload failed (${xhr.status})`));
        };
        xhr.onerror = () => reject(new Error("Network error while uploading."));
        xhr.onabort = () => reject(new Error("Upload cancelled."));
        xhr.send(body);
      });

      setDoneNames(result.uploaded.map(item => item.filename));
      setProgress(100);
      await onSuccess(result);
      const names = result.uploaded.map(item => item.filename).join(", ");
      let message = `Installed ${names}.`;
      if (kind === "lora") {
        message += " Classify unverified LoRAs in the compatibility manager before generation if they stay disabled.";
      }
      if (result.discoveryError || result.notice) {
        message += ` ${result.notice || "Refresh models/LoRAs after ComfyUI is ready."}`;
      } else {
        message += " Pickers refreshed — select the new item to generate.";
      }
      onNotice?.(message);
      setBusy(false);
      setModalOpen(false);
      setPendingFiles([]);
      setProgress(0);
    } catch (err: any) {
      setError(err?.message || String(err));
      setBusy(false);
    } finally {
      xhrRef.current = null;
    }
  }

  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        accept=".safetensors,application/octet-stream"
        multiple
        className="library-upload-file-input"
        aria-hidden
        tabIndex={-1}
        onChange={event => {
          const files = Array.from(event.target.files || []);
          if (files.length) openWithFiles(files, kind);
          event.target.value = "";
        }}
      />

      {dragging && (
        <div className="library-upload-overlay" role="dialog" aria-label="Drop model or LoRA to install">
          <div className="library-upload-overlay-card">
            <Upload size={28} />
            <strong>Drop LoRA or model</strong>
            <p>.safetensors only · you will choose LoRA / diffusion / checkpoint next</p>
          </div>
        </div>
      )}

      {modalOpen && (
        <div className="library-upload-backdrop" role="presentation" onClick={() => !busy && resetModal()}>
          <div
            className="library-upload-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="library-upload-title"
            onClick={event => event.stopPropagation()}
          >
            <div className="library-upload-modal-head">
              <div>
                <span className="eyebrow">LIBRARY INSTALL</span>
                <h2 id="library-upload-title">Upload model or LoRA</h2>
                <p>Files install into Comfy-registered folders and become selectable through the normal pickers. Existing files are never overwritten.</p>
              </div>
              <button type="button" className="icon" onClick={resetModal} disabled={busy} aria-label="Close upload dialog">
                <X />
              </button>
            </div>

            {activeJobCount > 0 && (
              <div className="library-upload-soft-warn" role="status">
                <AlertCircle size={16} />
                <span>{activeJobCount} generation job{activeJobCount === 1 ? "" : "s"} active. Upload is independent file I/O and will not cancel jobs, but large copies can compete for disk bandwidth.</span>
              </div>
            )}

            <div className="library-upload-kind" role="radiogroup" aria-label="Install as">
              {KIND_OPTIONS.map(option => (
                <label key={option.value} className={kind === option.value ? "active" : ""}>
                  <input
                    type="radio"
                    name="library-kind"
                    value={option.value}
                    checked={kind === option.value}
                    disabled={busy}
                    onChange={() => setKind(option.value)}
                  />
                  <span>
                    <strong>{option.label}</strong>
                    <small>{option.help}</small>
                  </span>
                </label>
              ))}
            </div>

            <div className="library-upload-files">
              <div className="library-upload-files-head">
                <strong>Files</strong>
                <button type="button" disabled={busy} onClick={() => fileInputRef.current?.click()}>
                  Choose .safetensors…
                </button>
              </div>
              {pendingFiles.length ? (
                <ul>
                  {pendingFiles.map(file => (
                    <li key={`${file.name}-${file.size}-${file.lastModified}`}>
                      <span className="library-upload-name" title={file.name}>{file.name}</span>
                      <span className="library-upload-size">{formatBytes(file.size)}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="library-upload-empty">No files selected yet. Drop onto the window or choose files.</p>
              )}
            </div>

            {busy && (
              <div className="library-upload-progress" aria-live="polite">
                <div className="library-upload-progress-bar"><i style={{ width: `${progress}%` }} /></div>
                <small><LoaderCircle className="spin" size={14} /> Uploading… {progress}%</small>
              </div>
            )}

            {error && (
              <div className="library-upload-error" role="alert">
                <AlertCircle size={16} />
                <span>{error}</span>
              </div>
            )}

            {doneNames.length > 0 && !busy && !error && (
              <div className="library-upload-success" role="status">
                <Check size={16} />
                <span>Installed {doneNames.join(", ")}</span>
              </div>
            )}

            <div className="library-upload-actions">
              <button type="button" onClick={resetModal} disabled={busy}>Cancel</button>
              <button
                type="button"
                className="primary"
                disabled={busy || !pendingFiles.length}
                onClick={() => void startUpload()}
              >
                {busy ? <LoaderCircle className="spin" size={16} /> : <Upload size={16} />}
                <span>{busy ? "Installing…" : `Install as ${KIND_OPTIONS.find(item => item.value === kind)?.label || kind}`}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
