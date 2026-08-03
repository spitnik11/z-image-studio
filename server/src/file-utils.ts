import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export function resolveInside(root: string, ...segments: string[]) {
  const resolvedRoot = path.resolve(root);
  const target = path.resolve(resolvedRoot, ...segments);
  if (target !== resolvedRoot && !target.startsWith(resolvedRoot + path.sep)) {
    throw new Error("The requested path escapes the application-owned directory.");
  }
  return target;
}

/** Locate a generation model or LoRA on disk for metadata (mtime/size). Does not create paths. */
export function findLibraryResource(
  projectRoot: string,
  kind: "model" | "lora",
  filename: string
): { path: string; mtimeMs: number; size: number } | undefined {
  const base = path.basename(filename);
  if (!base || base === "." || base === "..") return undefined;
  const candidates =
    kind === "lora"
      ? [
          path.join(projectRoot, "lora", base),
          path.join(projectRoot, "ComfyUI", "models", "loras", base)
        ]
      : [
          path.join(projectRoot, base),
          path.join(projectRoot, "checkpoints", base),
          path.join(projectRoot, "ComfyUI", "models", "diffusion_models", base),
          path.join(projectRoot, "ComfyUI", "models", "checkpoints", base)
        ];
  for (const candidate of candidates) {
    try {
      if (!fs.existsSync(candidate)) continue;
      const stat = fs.statSync(candidate);
      if (!stat.isFile()) continue;
      return { path: candidate, mtimeMs: stat.mtimeMs, size: stat.size };
    } catch {
      // skip unreadable paths
    }
  }
  return undefined;
}

export function writeJsonAtomic(file: string, value: unknown) {
  const resolved = path.resolve(file);
  const directory = path.dirname(resolved);
  fs.mkdirSync(directory, { recursive: true });
  const temporary = resolveInside(directory, `.${path.basename(resolved)}.${crypto.randomUUID()}.tmp`);
  const backup = `${resolved}.bak`;
  try {
    fs.writeFileSync(temporary, JSON.stringify(value, null, 2), { encoding: "utf8", flag: "wx" });
    if (fs.existsSync(resolved)) fs.copyFileSync(resolved, backup);
    fs.renameSync(temporary, resolved);
  } catch (error) {
    try { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); } catch {}
    throw error;
  }
}
