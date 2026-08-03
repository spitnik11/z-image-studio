import fs from "node:fs";
const path = "Z:/codex app/app/src/main.tsx";
let c = fs.readFileSync(path, "utf8");
const bad = '{busy?<LoaderCircle className="spin"/>:<Zap size={16}/}<span>';
const good = '{busy?<LoaderCircle className="spin"/>:<Zap size={16}/>}<span>';
if (!c.includes(bad)) {
  const i = c.indexOf("Zap size={16}");
  console.log("nearby", JSON.stringify(c.substring(i - 50, i + 50)));
  // broader fix: /}<span after Zap
  c = c.replace(/<Zap size=\{16\}\/\}<span/g, "<Zap size={16}/}><span");
  // wait wrong
  c = c.replace(/<Zap size=\{16\}\/\}/g, "<Zap size={16}/>}");
  console.log("broad fix applied");
} else {
  c = c.replace(bad, good);
  console.log("exact fix applied");
}
fs.writeFileSync(path, c, "utf8");
console.log("ok", c.includes('<Zap size={16}/>}'));
