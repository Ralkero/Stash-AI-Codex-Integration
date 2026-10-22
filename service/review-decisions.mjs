import { randomUUID, randomBytes } from "node:crypto";
import { object, check, id, string, choice } from "./validation.mjs";
import { assessScene, REVIEW_CHECKS } from "./review-policy.mjs";

const FILE = "review-decisions.json",
  LIMIT = 5000,
  TTL = 10 * 60 * 1000;
const hash = (v) => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
const uuid = (v) => typeof v === "string" && /^[a-f0-9-]{36}$/.test(v);
export function decisionInput(args) {
  object(args, ["sceneId", "findings", "action", "note"]);
  id(args.sceneId);
  choice(args.action, ["no-action", "reopen"]);
  check(
    Array.isArray(args.findings) &&
      args.findings.length > 0 &&
      args.findings.length <= 6 &&
      new Set(args.findings).size === args.findings.length,
  );
  check(args.findings.every((k) => Object.hasOwn(REVIEW_CHECKS, k)));
  if (args.note !== undefined) string(args.note, 300);
  return args;
}
export class ReviewDecisions {
  constructor(store, readScene, now = Date.now) {
    Object.assign(this, {
      store,
      readScene,
      now,
      events: [],
      pending: new Map(),
      available: false,
      queue: Promise.resolve(),
    });
  }
  async init() {
    try {
      const data = await this.store.read(FILE, { schema: 1, events: [] });
      object(data, ["schema", "events"]);
      check(
        data.schema === 1 &&
          Array.isArray(data.events) &&
          data.events.length <= LIMIT,
      );
      const seen = new Set();
      for (const e of data.events) {
        object(e, [
          "id",
          "requestId",
          "owner",
          "thread",
          "sceneId",
          "key",
          "fingerprint",
          "action",
          "at",
          "note",
          "previousId",
        ]);
        check(uuid(e.id) && uuid(e.requestId) && !seen.has(e.id));
        seen.add(e.id);
        check(
          string(e.owner, 200).length > 0 && string(e.thread, 200).length > 0,
        );
        id(e.sceneId);
        check(Object.hasOwn(REVIEW_CHECKS, e.key) && hash(e.fingerprint));
        choice(e.action, ["no-action", "reopen"]);
        check(Number.isSafeInteger(e.at) && e.at > 0);
        string(e.note, 300);
        const prior = this.events.findLast(
          (v) =>
            v.owner === e.owner && v.sceneId === e.sceneId && v.key === e.key,
        );
        check(e.previousId === (prior?.id || null));
        check(e.action !== "reopen" || prior?.action === "no-action");
        this.events.push(e);
      }
      this.available = true;
    } catch {
      this.events = [];
      this.available = false;
    }
  }
  latest(owner, sceneId, key) {
    return this.events.findLast(
      (e) => e.owner === owner && e.sceneId === sceneId && e.key === key,
    );
  }
  states(owner, scene) {
    if (!this.available) return [];
    return Object.keys(REVIEW_CHECKS).flatMap((key) => {
      const e = this.latest(owner, scene.sceneId, key);
      if (!e) return [];
      const fingerprint = scene.reviewEvidence?.[key];
      return [
        {
          key,
          at: e.at,
          note: e.note,
          state:
            e.action === "reopen"
              ? "reopened"
              : !fingerprint
                ? "unverified"
                : e.fingerprint === fingerprint
                  ? "active"
                  : "changed",
        },
      ];
    });
  }
  prune() {
    for (const [id, r] of this.pending)
      if (r.expiresAt <= this.now()) this.pending.delete(id);
  }
  list(owner, thread) {
    this.prune();
    return [...this.pending.values()]
      .filter(
        (r) =>
          r.owner === owner &&
          r.thread === thread &&
          !r.result &&
          r.rows.length > 0,
      )
      .map(({ owner: _o, thread: _t, ...r }) =>
        structuredClone({ ...r, createdAt: r.expiresAt - TTL }),
      );
  }
  cancel(owner, thread) {
    for (const [id, r] of this.pending)
      if (r.owner === owner && r.thread === thread) this.pending.delete(id);
  }
  async prepare(owner, thread, args, expected) {
    check(this.available, "REVIEW_DECISIONS_UNAVAILABLE");
    decisionInput(args);
    this.prune();
    check(this.pending.size < 32, "RATE_LIMIT");
    // Reserve synchronously, before the fresh read, to bound concurrent work.
    const requestId = randomUUID();
    const r = {
      id: requestId,
      owner,
      thread,
      token: randomBytes(32).toString("base64url"),
      sceneId: args.sceneId,
      action: args.action,
      note: args.note || "",
      rows: [],
      expiresAt: this.now() + TTL,
    };
    this.pending.set(requestId, r);
    try {
      const scene = await this.readScene(args.sceneId);
      check(this.pending.get(requestId) === r, "REVIEW_REQUEST_CANCELLED");
      const checks = assessScene(scene).checks;
      r.rows = args.findings.map((key) => {
        const previous = this.latest(owner, args.sceneId, key),
          fingerprint = scene.reviewEvidence?.[key];
        if (args.action === "no-action") {
          check(
            checks.some((c) => c.key === key && c.state === "observed") &&
              hash(fingerprint),
            "REVIEW_EVIDENCE_UNAVAILABLE",
          );
          if (expected)
            check(expected[key] === fingerprint, "REVIEW_EVIDENCE_CHANGED");
          check(
            !(
              previous?.action === "no-action" &&
              previous.fingerprint === fingerprint
            ),
            "REVIEW_ALREADY_ACKNOWLEDGED",
          );
        } else
          check(previous?.action === "no-action", "REVIEW_NOT_ACKNOWLEDGED");
        return {
          key,
          label: REVIEW_CHECKS[key].label,
          fingerprint:
            args.action === "reopen" ? previous.fingerprint : fingerprint,
          previousId: previous?.id || null,
        };
      });
      // The model receives no confirmation token. Only authenticated UI listing
      // exposes it; preparation never writes persistent preference state.
      return {
        id: r.id,
        status: "awaiting-ui-confirmation",
        sceneId: r.sceneId,
        action: r.action,
        findings: r.rows.map((v) => ({ key: v.key, label: v.label })),
        expiresAt: r.expiresAt,
      };
    } catch (e) {
      this.pending.delete(requestId);
      throw e;
    }
  }
  confirm(owner, thread, input) {
    const job = this.queue.then(() => this.commit(owner, thread, input));
    this.queue = job.catch(() => {});
    return job;
  }
  async commit(owner, thread, input) {
    object(input, ["id", "token", "decision"]);
    choice(input.decision, ["confirm", "cancel"]);
    check(this.available, "REVIEW_DECISIONS_UNAVAILABLE");
    const r = this.pending.get(input.id);
    check(
      r &&
        r.owner === owner &&
        r.thread === thread &&
        r.token === input.token &&
        r.expiresAt > this.now() &&
        r.rows.length > 0,
      "REVIEW_CONFIRMATION_DENIED",
    );
    if (r.result) return r.result;
    if (input.decision === "cancel") {
      this.pending.delete(r.id);
      return { status: "cancelled" };
    }
    const scene =
      r.action === "no-action" ? await this.readScene(r.sceneId) : null;
    check(this.pending.get(r.id) === r, "REVIEW_REQUEST_CANCELLED");
    check(r.expiresAt > this.now(), "REVIEW_CONFIRMATION_DENIED");
    for (const row of r.rows) {
      check(
        (this.latest(owner, r.sceneId, row.key)?.id || null) === row.previousId,
        "REVIEW_DECISION_CHANGED",
      );
      if (scene)
        check(
          scene.reviewEvidence?.[row.key] === row.fingerprint &&
            assessScene(scene).checks.some(
              (c) => c.key === row.key && c.state === "observed",
            ),
          "REVIEW_EVIDENCE_CHANGED",
        );
    }
    check(this.events.length + r.rows.length <= LIMIT, "REVIEW_STORAGE_FULL");
    const added = r.rows.map((row) => ({
      id: randomUUID(),
      requestId: r.id,
      owner,
      thread,
      sceneId: r.sceneId,
      key: row.key,
      fingerprint: row.fingerprint,
      action: r.action,
      at: this.now(),
      note: r.note,
      previousId: row.previousId,
    }));
    const events = [...this.events, ...added];
    try {
      await this.store.write(FILE, { schema: 1, events });
    } catch {
      this.available = false;
      throw Error("REVIEW_DECISIONS_UNAVAILABLE");
    }
    this.events = events;
    r.result = {
      status: r.action === "reopen" ? "reopened" : "acknowledged",
      sceneId: r.sceneId,
      findings: r.rows.map((v) => v.key),
      metadataChanged: false,
    };
    return r.result;
  }
}
