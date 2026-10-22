import {
  randomBytes,
  randomUUID,
  createHash,
  timingSafeEqual,
} from "node:crypto";
import { check } from "./validation.mjs";
const hash = (x) => createHash("sha256").update(x).digest("hex");
const secret = () => randomBytes(32).toString("base64url");
const matches = (a, b) =>
  typeof a === "string" &&
  typeof b === "string" &&
  a.length === b.length &&
  timingSafeEqual(Buffer.from(a), Buffer.from(b));
export class Auth {
  constructor(store, origins, port, now = Date.now) {
    Object.assign(this, { store, origins, port, now });
    this.nonces = new Map();
    this.attempts = [];
    this.queue = Promise.resolve();
  }
  async init() {
    this.state = await this.store.read("auth.json", {
      schema: 1,
      pairings: [],
    });
    this.state.principal ??= this.state.pairings[0]?.owner || randomUUID();
    if (!this.state.pairCode) {
      this.state.pairCode = secret();
      this.state.pairExpires = this.now() + 15 * 60 * 1000;
      await this.save();
    }
  }
  save() {
    return this.store.write("auth.json", this.state);
  }
  checkOrigin(req) {
    check(req.headers.host === `127.0.0.1:${this.port}`, "HOST_DENIED");
    check(this.origins.includes(req.headers.origin), "ORIGIN_DENIED");
  }
  async pair(code, origin) {
    const task = this.queue.then(async () => {
      this.attempts = this.attempts.filter((t) => t > this.now() - 60000);
      check(this.attempts.length < 5, "PAIR_RATE_LIMIT");
      this.attempts.push(this.now());
      check(
        this.state.pairExpires > this.now() &&
          matches(code, this.state.pairCode),
        "PAIR_DENIED",
      );
      const token = secret(),
        owner = this.state.principal;
      this.state.pairings.push({
        owner,
        hash: hash(token),
        origin,
        createdAt: this.now(),
      });
      delete this.state.pairCode;
      delete this.state.pairExpires;
      await this.save();
      return { token, owner };
    });
    this.queue = task.catch(() => {});
    return task;
  }
  authorize(req) {
    const bearer = req.headers.authorization || "";
    check(bearer.startsWith("Bearer "), "AUTH_REQUIRED");
    const p = this.state.pairings.find(
      (p) =>
        p.origin === req.headers.origin &&
        matches(p.hash, hash(bearer.slice(7))),
    );
    check(p, "AUTH_REQUIRED");
    const timestamp = Number(req.headers["x-stash-ai-time"]),
      nonce = req.headers["x-stash-ai-nonce"];
    check(
      Number.isFinite(timestamp) && Math.abs(this.now() - timestamp) < 60000,
      "REQUEST_EXPIRED",
    );
    check(
      typeof nonce === "string" && /^[a-f0-9-]{36}$/.test(nonce),
      "INVALID_NONCE",
    );
    for (const [key, t] of this.nonces)
      if (t < this.now() - 120000) this.nonces.delete(key);
    const key = p.owner + ":" + nonce;
    check(!this.nonces.has(key), "REPLAY_DENIED");
    this.nonces.set(key, this.now());
    check(this.nonces.size < 10000, "RATE_LIMIT");
    return p.owner;
  }
  async revoke(bearer) {
    const task = this.queue.then(async () => {
      const tokenHash = hash(bearer.slice(7));
      this.state.pairings = this.state.pairings.filter(
        (p) => p.hash !== tokenHash,
      );
      await this.save();
    });
    this.queue = task.catch(() => {});
    return task;
  }
}
