import fs from "node:fs";

const path = "app/src/main.tsx";
let s = fs.readFileSync(path, "utf8");

const oldHead =
  '{active.some(r=>r.status==="active")&&<button onClick={()=>api("/api/interrupt",{method:"POST"})}>Interrupt</button>}';
const newHead =
  '{active.length>0&&<button type="button" onClick={()=>{void (async()=>{for(const job of active){try{await api(`/api/gallery/${job.id}/dismiss`,{method:"POST"})}catch(e:any){setNotice(e.message||String(e));break}}refresh()})()}} title="Clear pending/active Activity jobs (safe — does not delete models or outputs)" aria-label="Clear stuck jobs">Clear stuck</button>}{active.some(r=>r.status==="active")&&<button onClick={()=>api("/api/interrupt",{method:"POST"})}>Interrupt</button>}';

if (!s.includes(oldHead)) {
  console.error("queue-head interrupt pattern not found");
  process.exit(1);
}
s = s.replace(oldHead, newHead);

const oldX =
  "onClick={()=>api(`/api/jobs/${r.promptId}/cancel`,{method:\"POST\"}).then(refresh)} aria-label=\"Cancel job\"";
const newX =
  "onClick={()=>api(`/api/gallery/${r.id}/dismiss`,{method:\"POST\"}).then(refresh).catch((e:any)=>setNotice(e.message||String(e)))} aria-label=\"Clear or cancel job\" title=\"Clear job from Activity (safe — does not delete models)\"";

if (!s.includes(oldX)) {
  console.error("per-job cancel pattern not found");
  process.exit(1);
}
s = s.replace(oldX, newX);

fs.writeFileSync(path, s);
console.log("main.tsx queue dismiss UI updated");
