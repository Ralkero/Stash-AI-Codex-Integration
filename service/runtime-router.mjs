import { EventEmitter } from "node:events";
import path from "node:path";
import { Runtime } from "./runtime.mjs";

// New IDs are isolated. The immutable cutover manifest is the only authority
// allowing an old, already-owned ID to resolve in the desktop's original home.
export class RuntimeRouter extends EventEmitter {
  constructor({
    store,
    conversations,
    factory = (options) => new Runtime(options),
    legacyIdleMs = 30000,
    ...options
  }) {
    super();
    Object.assign(this, {
      store,
      conversations,
      factory,
      options,
      legacyIdleMs,
    });
    this.tools = options.tools;
    this.threads = new Set();
    this.entries = new Map();
    this.newIds = new Set();
    this.active = new Set();
  }
  async start() {
    this.storage = await this.store.read("runtime-storage.json", null);
    if (!this.storage) {
      if (this.conversations.length) throw Error("STORAGE_SETUP_REQUIRED");
      this.storage = { schema: 1, legacyHome: null, legacyThreadIds: [] };
      await this.store.write("runtime-storage.json", this.storage);
    }
    const s = this.storage;
    if (
      s.schema !== 1 ||
      Object.keys(s).some(
        (k) => !["schema", "legacyHome", "legacyThreadIds"].includes(k),
      ) ||
      !Array.isArray(s.legacyThreadIds) ||
      s.legacyThreadIds.some(
        (id) =>
          typeof id !== "string" ||
          !this.conversations.some((c) => c.id === id && !c.storage),
      ) ||
      new Set(s.legacyThreadIds).size !== s.legacyThreadIds.length ||
      (s.legacyThreadIds.length &&
        (typeof s.legacyHome !== "string" || !path.isAbsolute(s.legacyHome)))
    )
      throw Error("INVALID_STORAGE_ORIGIN");
    this.isolated = path.join(this.store.dir, "codex-home");
    if (
      s.legacyHome &&
      path.resolve(s.legacyHome).toLowerCase() === this.isolated.toLowerCase()
    )
      throw Error("INVALID_STORAGE_ORIGIN");
    for (const c of this.conversations) this.origin(c.id);
    const rt = await this.get("isolated");
    this.authenticated = rt.authenticated;
    this.models = rt.models;
    return { authenticated: this.authenticated };
  }
  origin(id) {
    if (this.newIds.has(id)) return "isolated";
    const c = this.conversations.find((c) => c.id === id);
    if (!c) throw Error("THREAD_DENIED");
    if (c.storage === "isolated" && !this.storage.legacyThreadIds.includes(id))
      return "isolated";
    if (!c.storage && this.storage.legacyThreadIds.includes(id))
      return "legacy";
    throw Error("INVALID_STORAGE_ORIGIN");
  }
  async get(origin) {
    if (this.closed) throw Error("CODEX_DISCONNECTED");
    const existing = this.entries.get(origin);
    if (existing) {
      clearTimeout(existing.timer);
      return existing.ready;
    }
    const entry = { busy: 0 };
    const rt = this.factory({
      ...this.options,
      tools: this.tools,
      codexHome:
        origin === "isolated" ? this.isolated : this.storage.legacyHome,
      isolatedHome: origin === "isolated",
      dispatch: (p) => {
        if (this.origin(p.threadId) !== origin || !this.active.has(p.threadId))
          throw Error("TOOL_DENIED");
        return this.options.dispatch(p);
      },
    });
    entry.rt = rt;
    this.entries.set(origin, entry);
    rt.on("notification", (m) => {
      const id = m.params?.threadId;
      if (!id) return;
      try {
        if (this.origin(id) !== origin) return;
      } catch {
        return;
      }
      if (m.method === "turn/completed") {
        this.active.delete(id);
        this.armIdle(origin, entry);
      }
      this.emit("notification", m);
    });
    rt.on("unavailable", (code) => {
      if (entry.closing) return;
      this.authenticated = false;
      this.emit("unavailable", code);
    });
    entry.ready = rt
      .start()
      .then(() => rt)
      .catch((error) => {
        this.retire(origin, entry);
        throw error;
      });
    return entry.ready;
  }
  armIdle(origin, entry) {
    if (
      origin !== "legacy" ||
      entry.closing ||
      entry.busy ||
      [...this.active].some((id) => this.origin(id) === origin)
    )
      return;
    clearTimeout(entry.timer);
    entry.timer = setTimeout(
      () => this.retire(origin, entry),
      this.legacyIdleMs,
    );
    entry.timer.unref?.();
  }
  retire(origin, entry) {
    if (entry.closing) return;
    entry.closing = true;
    clearTimeout(entry.timer);
    if (this.entries.get(origin) === entry) this.entries.delete(origin);
    for (const id of entry.rt.threads) this.threads.delete(id);
    entry.rt.close();
  }
  async withThread(id, operation, { resume = true } = {}) {
    const origin = this.origin(id);
    const rt = await this.get(origin);
    const entry = this.entries.get(origin);
    entry.busy++;
    try {
      // Do not create a substitute when a stored ID cannot be found.
      if (resume && !rt.threads.has(id)) {
        // Guidance, like dispatch semantics, follows the saved catalog. The
        // server retains dynamicTools; resume never supplies replacement tools.
        const thread = await rt.resume(
          id,
          this.conversations.find((c) => c.id === id)?.toolSchema || 1,
        );
        if (thread.id !== id) throw Error("THREAD_ID_MISMATCH");
        this.threads.add(id);
      }
      return await operation(rt);
    } finally {
      entry.busy--;
      this.armIdle(origin, entry);
    }
  }
  async create() {
    const rt = await this.get("isolated");
    if (!rt.authenticated) throw Error("CODEX_NOT_READY");
    rt.tools = this.tools;
    const thread = await rt.create();
    if (this.conversations.some((c) => c.id === thread.id))
      throw Error("THREAD_ID_MISMATCH");
    this.newIds.add(thread.id);
    this.threads.add(thread.id);
    return thread;
  }
  // An empty persisted thread has no readable turns yet.
  async resume(id) {
    try {
      return await this.withThread(id, async () => ({ id }));
    } catch (error) {
      const c = this.conversations.find((row) => row.id === id);
      // Pinned App Server does not persist a rollout before the first turn.
      // Signal this one proven pre-dispatch case to the UI; never replace a
      // historical, legacy, renamed, or uncertain conversation in the router.
      if (
        c?.storage === "isolated" &&
        !c.startedAt &&
        c.title === "New conversation" &&
        error.message ===
          `CODEX_REQUEST_FAILED: no rollout found for thread id ${id}`
      )
        throw Error("EMPTY_CHAT_EXPIRED");
      throw error;
    }
  }
  read(id) {
    return this.withThread(id, (rt) => rt.read(id), { resume: false });
  }
  async turn(id, text) {
    this.origin(id);
    if (this.active.size) throw Error("BUSY");
    this.active.add(id);
    try {
      return await this.withThread(id, (rt) => {
        if (!rt.authenticated) throw Error("CODEX_NOT_READY");
        return rt.turn(id, text);
      });
    } catch (e) {
      this.active.delete(id);
      throw e;
    }
  }
  interrupt(id, turnId) {
    return this.withThread(id, (rt) => rt.interrupt(id, turnId));
  }
  close() {
    this.closed = true;
    for (const [origin, entry] of this.entries) this.retire(origin, entry);
  }
}
