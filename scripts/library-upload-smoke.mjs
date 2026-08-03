import fs from "node:fs";
import path from "node:path";
import http from "node:http";

const root = "Z:/codex app";
const tmp = process.env.TEMP || process.env.TMP || ".";

function writeTiny(name) {
  const p = path.join(tmp, name);
  fs.writeFileSync(p, Buffer.concat([Buffer.alloc(8), Buffer.from("{}")]));
  return p;
}

function post(kind, filePath) {
  const boundary = `----zstudio${Date.now()}`;
  const filename = path.basename(filePath);
  const fileBuf = fs.readFileSync(filePath);
  const head = Buffer.from(
    `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="kind"\r\n\r\n${kind}\r\n` +
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="files"; filename="${filename}"\r\n` +
      `Content-Type: application/octet-stream\r\n\r\n`
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  const body = Buffer.concat([head, fileBuf, tail]);
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port: 3199,
        path: "/api/library/upload",
        method: "POST",
        headers: {
          "Content-Type": `multipart/form-data; boundary=${boundary}`,
          "Content-Length": body.length
        }
      },
      res => {
        let data = "";
        res.on("data", chunk => { data += chunk; });
        res.on("end", () => resolve({ status: res.statusCode, body: data }));
      }
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

function cleanup(names) {
  for (const name of names) {
    for (const candidate of [
      path.join(root, "lora", name),
      path.join(root, "checkpoints", name),
      path.join(root, name)
    ]) {
      if (fs.existsSync(candidate)) {
        fs.unlinkSync(candidate);
        console.log("removed", candidate);
      }
    }
  }
}

const lora = "zstudio_upload_smoke_test.safetensors";
const diff = "zstudio_upload_smoke_diffusion.safetensors";
const ckpt = "zstudio_upload_smoke_checkpoint.safetensors";
cleanup([lora, diff, ckpt]);

const loraPath = writeTiny(lora);
const diffPath = writeTiny(diff);
const ckptPath = writeTiny(ckpt);
const badPath = path.join(tmp, "zstudio_upload_smoke.txt");
fs.writeFileSync(badPath, "nope");

const r1 = await post("lora", loraPath);
console.log("1 lora", r1.status, r1.body.slice(0, 400));
console.log("exists lora", fs.existsSync(path.join(root, "lora", lora)));

const r2 = await post("lora", loraPath);
console.log("2 dup", r2.status, r2.body.slice(0, 400));

const r3 = await post("diffusion", diffPath);
console.log("3 diffusion", r3.status, r3.body.slice(0, 400));
console.log("exists diffusion", fs.existsSync(path.join(root, diff)));

const r4 = await post("checkpoint", ckptPath);
console.log("4 checkpoint", r4.status, r4.body.slice(0, 400));
console.log("exists checkpoint", fs.existsSync(path.join(root, "checkpoints", ckpt)));

const r5 = await post("lora", badPath);
console.log("5 bad", r5.status, r5.body.slice(0, 400));

cleanup([lora, diff, ckpt]);
console.log("SMOKE_DONE");
