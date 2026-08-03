import fs from "node:fs";

const path = "Z:/codex app/app/src/main.tsx";
let c = fs.readFileSync(path, "utf8");

// Broken line break inside onChange
c = c.replace(/setImg2imgNoise\(\+\s*[\r\n]+\s*e\.target\.value\)/g, "setImg2imgNoise(+e.target.value)");

// `as const` inside JSX confuses TS — use a plain typed cast once
const bad =
  '(img2imgMode==="refine"?[["Soft",0.18,0.02],["Refine",0.25,0.05],["Polish",0.32,0.08]] as const:[["Mild",0.35,0.1],["Medium",0.45,0.15],["Strong",0.6,0.25]] as const).map';
const good =
  '((img2imgMode==="refine"?[["Soft",0.18,0.02],["Refine",0.25,0.05],["Polish",0.32,0.08]]:[["Mild",0.35,0.1],["Medium",0.45,0.15],["Strong",0.6,0.25]]) as Array<[string, number, number]>).map';
if (!c.includes(bad) && !c.includes("as Array<[string, number, number]>")) {
  // try looser
  const i = c.indexOf("improve-presets");
  console.log("presets region:", c.substring(i, i + 350));
}
if (c.includes(bad)) {
  c = c.replace(bad, good);
  console.log("presets cast fixed");
}

// Replace ≤ which can confuse some parsers in text - use ascii
c = c.replace(/≤0\.38/g, "<=0.38");

fs.writeFileSync(path, c, "utf8");
console.log("wrote", c.length);
console.log("noise onChange ok", /setImg2imgNoise\(\+e\.target\.value\)/.test(c));
console.log("has cast", c.includes("Array<[string, number, number]>"));
