import WebSocket from "ws";

const objectInfoCache = new Map<string, { value?: unknown; expiresAt: number; pending?: Promise<unknown> }>();

export class ComfyClient {
  constructor(public url: string) {}
  private endpoint(p: string) { return `${this.url.replace(/\/$/, "")}${p}`; }
  async json(path: string, init?: RequestInit, timeoutMs = 10_000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      let response: Response;
      try {
        response = await fetch(this.endpoint(path), { ...init, signal: controller.signal });
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
          throw new Error(`ComfyUI did not respond within ${Math.round(timeoutMs / 1000)} seconds at ${this.url}.`);
        }
        throw new Error(`Cannot reach ComfyUI at ${this.url}. Start ComfyUI or correct the server URL in Setup.`);
      }
      if (!response.ok) throw new Error(`ComfyUI ${response.status}: ${await response.text()}`);
      return await response.json();
    } finally { clearTimeout(timer); }
  }
  // A large local library makes this catalog expensive. Deduplicate concurrent
  // startup reads and briefly reuse it while a multi-run batch is submitted.
  objectInfo() {
    const key = this.url.replace(/\/$/, "");
    const cached = objectInfoCache.get(key);
    if (cached?.value && cached.expiresAt > Date.now()) return Promise.resolve(cached.value);
    if (cached?.pending) return cached.pending;
    const pending = this.json("/object_info", undefined, 60_000)
      .then(value => {
        objectInfoCache.set(key, { value, expiresAt: Date.now() + 5_000 });
        return value;
      })
      .catch(error => {
        objectInfoCache.delete(key);
        throw error;
      });
    objectInfoCache.set(key, { value: cached?.value, expiresAt: cached?.expiresAt || 0, pending });
    return pending;
  }
  stats() { return this.json("/system_stats"); }
  history(id: string) { return this.json(`/history/${encodeURIComponent(id)}`); }
  queue() { return this.json("/queue"); }
  submit(prompt: unknown, clientId: string, priority: "next" | "normal" | "low" = "normal", timeoutMs = 60_000) {
    const queue: Record<string, unknown> = {};
    if (priority === "next") queue.front = true;
    if (priority === "low") queue.number = 1_000_000_000_000 + Date.now();
    // Dataset batches submit many graphs; allow longer than the default 10s catalog timeout.
    return this.json("/prompt", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt, client_id: clientId, ...queue })
    }, timeoutMs);
  }
  deleteQueued(promptId: string) {
    return this.json("/queue", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ delete: [promptId] })
    });
  }
  interrupt() { return this.json("/interrupt", { method: "POST" }); }
  imageUrl(filename: string, subfolder = "", type = "output") {
    const q = new URLSearchParams({ filename, subfolder, type });
    return this.endpoint(`/view?${q}`);
  }
  socket(clientId: string) {
    const wsUrl = this.url.replace(/^http/, "ws").replace(/\/$/, "");
    return new WebSocket(`${wsUrl}/ws?clientId=${encodeURIComponent(clientId)}`);
  }
}
