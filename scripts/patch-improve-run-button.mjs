import fs from "node:fs";

const path = "Z:/codex app/app/src/main.tsx";
let c = fs.readFileSync(path, "utf8");
const orig = c.length;

const oldNotice =
  "Improve ready: Medium magnitude (Strength 0.45 · Noise 0.15). Adjust below, then Generate.";
const newNotice =
  "Improve ready: Medium magnitude (Strength 0.45 · Noise 0.15). Adjust below, then press Run Improve in this panel.";
if (c.includes(oldNotice)) {
  c = c.replace(oldNotice, newNotice);
  console.log("notice ok");
}

const marker =
  "higher invites new detail (can artifact if overused)</small></label></div></div>}";
if (!c.includes(marker)) {
  const i = c.indexOf("improve-panel");
  console.log(c.substring(i, i + 1600).slice(-500));
  throw new Error("panel end marker missing");
}

const withButton =
  'higher invites new detail (can artifact if overused)</small></label></div>' +
  '<div className="improve-actions">' +
  '<button type="button" className="improve-run" disabled={!canGenerate||!improveSource||busy} onClick={()=>generate()} title="Queue Improve with the Strength and Noise above">' +
  '{busy?<LoaderCircle className="spin"/>:<Zap size={16}/>}' +
  '<span>{busy?"Sending Improve…":"Run Improve"}</span>' +
  "</button>" +
  "<small>Connected · source <strong title={improveSource.label}>{improveSource.label}</strong> · Strength {img2imgStrength.toFixed(2)} · Noise {img2imgNoise.toFixed(2)}</small>" +
  "</div></div>}";

if (c.includes("improve-run")) {
  console.log("button already present");
} else {
  c = c.replace(marker, withButton);
  console.log("button ok");
}

if (c.length < orig * 0.95) throw new Error(`refusing shrink ${orig} -> ${c.length}`);
fs.writeFileSync(path, c, "utf8");
console.log("wrote main", c.length);

const cssPath = "Z:/codex app/app/src/styles.css";
let css = fs.readFileSync(cssPath, "utf8");
if (!css.includes(".improve-run")) {
  css += `

.improve-actions{display:flex;flex-direction:column;gap:0.45rem;margin-top:0.75rem;padding-top:0.75rem;border-top:1px solid rgba(255,255,255,0.08)}
.improve-run{display:inline-flex;align-items:center;justify-content:center;gap:0.45rem;width:100%;padding:0.7rem 1rem;border:none;border-radius:10px;background:var(--accent,#b8ff4a);color:#0c1006;font-weight:650;font-size:0.95rem;cursor:pointer}
.improve-run:disabled{opacity:0.45;cursor:not-allowed}
.improve-run:not(:disabled):hover{filter:brightness(1.05)}
.improve-actions small{font-size:0.78rem;opacity:0.75;line-height:1.3}
`;
  fs.writeFileSync(cssPath, css, "utf8");
  console.log("css ok");
}
