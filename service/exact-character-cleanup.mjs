import { randomBytes, randomUUID } from "node:crypto";
import { check, object } from "./validation.mjs";
import { seal } from "./tag-cleanup-policy.mjs";
import {
  EXACT,
  hash,
  same,
  exactIds,
  sceneTags,
  metadata,
  sourceMatches,
  validateSource,
  validateManifest,
} from "./exact-character-policy.mjs";
const indexFile = "exact-character-index.json",
  keyFile = "exact-character-key.json",
  sourceFile = "exact-character-source.json";
const file = (id) => {
  check(/^[a-f0-9-]{36}$/.test(id), "EXACT_ID_INVALID");
  return `exact-character-plan-${id}.json`;
};
const code = (e) =>
  /^[A-Z_]+$/.test(e?.message) ? e.message : "EXACT_OWNER_ERROR";
export class ExactCharacterCleanup {
  constructor({
    store,
    adapter,
    canWrite = () => false,
    emit = () => {},
    now = Date.now,
    schedule = true,
  }) {
    Object.assign(this, { store, adapter, canWrite, emit, now, schedule });
    this.queue = Promise.resolve();
    this.plans = new Map();
    this.challenges = new Map();
    this.pauses = new Set();
    this.timers = new Map();
    this.available = false;
    this.closing = false;
  }
  async init() {
    try {
      this.key = await this.store.read(keyFile, null);
      const signed = await this.store.read(indexFile, null);
      if (!this.key && !signed) {
        this.key = { key: randomBytes(32).toString("hex") };
        await this.store.write(keyFile, this.key);
        this.index = { schema: 1, plans: [] };
        await this.store.write(indexFile, this.wrap(this.index));
      } else {
        check(this.key?.key?.length === 64 && signed, "EXACT_STORAGE_CORRUPT");
        this.index = this.unwrap(signed);
      }
      check(
        this.index.schema === 1 &&
          Array.isArray(this.index.plans) &&
          this.index.plans.length <= EXACT.maxPlans &&
          new Set(this.index.plans).size === this.index.plans.length,
        "EXACT_STORAGE_CORRUPT",
      );
      for (const id of this.index.plans) {
        const p = this.unwrap(await this.store.read(file(id), null));
        this.verify(p);
        check(p.manifest.id === id, "EXACT_STORAGE_CORRUPT");
        this.plans.set(id, p);
        if (["executing", "approved"].includes(p.state)) {
          p.state = "paused";
          p.error = "EXACT_RESTART_REQUIRES_RESUME";
          await this.save(p, "restart-paused");
        }
      }
      this.available = true;
    } catch {
      this.available = false;
      this.error = "EXACT_STORAGE_CORRUPT";
    }
  }
  wrap(value) {
    return { value, mac: seal(this.key.key, value) };
  }
  unwrap(s) {
    check(
      s && s.mac === seal(this.key.key, s.value),
      "EXACT_INTEGRITY_FAILURE",
    );
    return s.value;
  }
  verify(p) {
    validateManifest(p.manifest);
    check(p.digest === hash(p.manifest), "EXACT_INTEGRITY_FAILURE");
    check(
      p.approval === null ||
        (p.approval?.owner === p.manifest.owner &&
          p.approval.planId === p.manifest.id &&
          p.approval.digest === p.digest &&
          p.approval.mac ===
            seal(this.key.key, {
              owner: p.approval.owner,
              planId: p.approval.planId,
              digest: p.approval.digest,
              approvedAt: p.approval.approvedAt,
              expiresAt: p.approval.expiresAt,
              context: p.approval.context,
            })),
      "EXACT_APPROVAL_INVALID",
    );
    check(
      p.rows.length === p.manifest.entries.length &&
        p.rows.every(
          (r, i) => r.operationId === p.manifest.entries[i].operationId,
        ),
      "EXACT_JOURNAL_INVALID",
    );
    let previous = null;
    for (const e of p.journal) {
      const { digest, ...body } = e;
      check(
        body.previous === previous && digest === hash(body),
        "EXACT_JOURNAL_INVALID",
      );
      previous = digest;
    }
  }
  serial(fn) {
    const task = this.queue.then(() => {
      check(this.available, "EXACT_STORAGE_UNAVAILABLE");
      return fn();
    });
    this.queue = task.catch(() => {});
    return task;
  }
  get(owner, id) {
    check(this.available, "EXACT_STORAGE_UNAVAILABLE");
    file(id);
    const p = this.plans.get(id);
    check(p?.manifest.owner === owner, "EXACT_DENIED");
    this.verify(p);
    return p;
  }
  async save(p, event, detail = {}) {
    check(
      Buffer.byteLength(JSON.stringify(p)) < 16 * 1024 * 1024,
      "EXACT_STORAGE_LIMIT",
    );
    const e = {
      sequence: p.journal.length,
      at: this.now(),
      event,
      detail,
      previous: p.journal.at(-1)?.digest || null,
    };
    p.journal.push({ ...e, digest: hash(e) });
    try {
      await this.store.write(file(p.manifest.id), this.wrap(p));
    } catch (e) {
      this.available = false;
      throw e;
    }
    this.emit(p.manifest.owner, { type: "exact-character-cleanup" });
  }
  async definitions(ids) {
    const rows = [];
    for (let i = 0; i < ids.length; i += 50)
      rows.push(...(await this.adapter.definitions(ids.slice(i, i + 50))));
    return rows;
  }
  async source(owner) {
    const s = this.unwrap(await this.store.read(sourceFile, null));
    validateSource(s);
    check(s.owner === owner, "EXACT_DENIED");
    return s;
  }
  summary(p) {
    this.verify(p);
    const counts = {
      pending: 0,
      intent: 0,
      verified: 0,
      skipped: 0,
      failed: 0,
      recovered: 0,
    };
    let removed = 0,
      observed = 0;
    for (let i = 0; i < p.rows.length; i++) {
      const r = p.rows[i];
      counts[r.status] = (counts[r.status] || 0) + 1;
      if (r.status === "verified")
        removed += p.manifest.entries[i].remove.length;
      if (r.status === "recovered")
        observed += p.manifest.entries[i].remove.length;
    }
    return {
      id: p.manifest.id,
      createdAt: p.manifest.createdAt,
      expiresAt: p.manifest.expiresAt,
      state:
        p.state === "awaiting-approval" && p.manifest.expiresAt <= this.now()
          ? "expired"
          : p.state,
      digest: p.digest,
      ...p.manifest.counts,
      counts,
      verifiedRelationships: removed,
      recoveredRelationships: observed,
      error: p.error || null,
      lastBatch: p.lastBatch || null,
      resumeAvailable:
        ["paused", "failed"].includes(p.state) &&
        Boolean(p.approval) &&
        p.approval.expiresAt > this.now() &&
        !p.rows.some((r) => r.status === "failed"),
      approved: Boolean(p.approval),
    };
  }
  async list(owner) {
    check(this.available, "EXACT_STORAGE_UNAVAILABLE");
    let preparationAvailable = false;
    try {
      const s = await this.source(owner);
      preparationAvailable = !Array.from(this.plans.values()).some(
        (p) =>
          p.manifest.source.digest === hash(s) &&
          p.state !== "awaiting-approval" &&
          !(
            p.state === "awaiting-approval" &&
            p.manifest.expiresAt <= this.now()
          ) &&
          !["expired", "invalidated"].includes(p.state),
      );
    } catch {}
    return {
      schema: 1,
      plans: [...this.plans.values()]
        .filter((p) => p.manifest.owner === owner)
        .map((p) => this.summary(p)),
      preparationAvailable,
    };
  }
  async prepare(owner, args = {}) {
    object(args, []);
    return this.serial(async () => {
      check(
        !this.blocksWrites() && this.index.plans.length < EXACT.maxPlans,
        "EXACT_OPERATION_OUTSTANDING",
      );
      const s = await this.source(owner);
      for (const p of this.plans.values())
        if (
          p.state === "awaiting-approval" &&
          p.manifest.expiresAt <= this.now()
        ) {
          p.state = "expired";
          await this.save(p, "review-expired");
        }
      const existing = [...this.plans.values()].find(
        (p) =>
          p.manifest.source.digest === hash(s) &&
          !["expired", "invalidated"].includes(p.state),
      );
      const environment = await this.adapter.environment();
      if (existing) {
        if (
          existing.state !== "awaiting-approval" ||
          existing.approval ||
          same(environment, existing.manifest.environment)
        )
          return this.summary(existing);
        existing.state = "invalidated";
        existing.error = "EXACT_ENVIRONMENT_CHANGED";
        this.challenges.delete(existing.manifest.id);
        await this.save(existing, "unapproved-review-environment-changed");
      }
      const entries = [],
        excluded = [...s.excluded];
      const allIds = [...new Set(s.rows.flatMap((r) => r.before))].sort(
        (a, b) => Number(a) - Number(b),
      );
      const defs = await this.definitions(allIds),
        byId = new Map(defs.filter(Boolean).map((t) => [t.id, t]));
      for (const r of s.rows) {
        let current;
        try {
          current = await this.adapter.scene(r.sceneId);
        } catch (e) {
          excluded.push({
            sceneId: r.sceneId,
            remove: r.remove,
            reason: code(e),
          });
          continue;
        }
        if (!sourceMatches(r.observedState, current)) {
          excluded.push({
            sceneId: r.sceneId,
            remove: r.remove,
            reason: r.remove.every((t) => !sceneTags(current).includes(t))
              ? "EXACT_ALREADY_ABSENT"
              : "EXACT_STALE_SOURCE",
          });
          continue;
        }
        if (
          r.before.some(
            (t) =>
              !byId.has(t) ||
              byId.get(t).name !==
                r.observedState.tags.find((v) => v.id === t)?.name,
          ) ||
          r.remove.some((t) => byId.get(t)?.ignore_auto_tag)
        ) {
          excluded.push({
            sceneId: r.sceneId,
            remove: r.remove,
            reason: "EXACT_TAG_MISSING_OR_IGNORED",
          });
          continue;
        }
        const before = sceneTags(current),
          remove = exactIds(r.remove),
          after = before.filter((t) => !remove.includes(t)),
          meta = metadata(current);
        entries.push({
          operationId: hash({ sceneId: r.sceneId, remove }),
          sceneId: r.sceneId,
          before,
          remove,
          after,
          names: Object.fromEntries(before.map((t) => [t, byId.get(t).name])),
          label: current.title || `Scene ${r.sceneId}`,
          metadata: meta,
          metadataHash: hash(meta),
          sourceFingerprint: r.beforeFingerprint,
          evidence: r.evidence,
          excluded: r.excluded,
        });
      }
      check(entries.length, "EXACT_NO_VALID_REMOVALS");
      entries.sort((a, b) => Number(a.sceneId) - Number(b.sceneId));
      const distinct = [...new Set(entries.flatMap((e) => e.remove))];
      const manifest = {
        schema: 1,
        type: EXACT.type,
        id: randomUUID(),
        owner,
        createdAt: this.now(),
        expiresAt: this.now() + EXACT.ttl,
        source: {
          reference: s.reference,
          fingerprint: s.sourceHash,
          digest: hash(s),
          historical: s.historical,
        },
        environment,
        entries,
        excluded,
        counts: {
          scenes: entries.length,
          relationships: entries.reduce((n, e) => n + e.remove.length, 0),
          distinctTags: distinct.length,
          emptyAfter: entries.filter((e) => !e.after.length).length,
          retainingTags: entries.filter((e) => e.after.length).length,
          reasons: Object.fromEntries(
            [
              ...new Set(
                entries.flatMap((e) =>
                  e.evidence.map((f) => f.reason || "Reviewed correction"),
                ),
              ),
            ].map((reason) => [
              reason,
              entries.reduce(
                (n, e) =>
                  n +
                  new Set(
                    e.evidence
                      .filter(
                        (f) => (f.reason || "Reviewed correction") === reason,
                      )
                      .map((f) => f.sourceId),
                  ).size,
                0,
              ),
            ]),
          ),
        },
        definitions: defs.filter(
          (t) => t && entries.some((e) => e.before.includes(t.id)),
        ),
      };
      validateManifest(manifest);
      const p = {
        manifest,
        digest: hash(manifest),
        state: "awaiting-approval",
        approval: null,
        rows: entries.map((e) => ({
          operationId: e.operationId,
          status: "pending",
          attempts: 0,
        })),
        journal: [],
        error: null,
      };
      await this.save(p, "validated-awaiting-approval");
      this.index.plans.push(manifest.id);
      try {
        await this.store.write(indexFile, this.wrap(this.index));
      } catch (e) {
        this.available = false;
        throw e;
      }
      this.plans.set(manifest.id, p);
      return this.summary(p);
    });
  }
  read(owner, args) {
    object(args, ["planId"]);
    const p = this.get(owner, args.planId);
    let challenge = null;
    if (p.state === "awaiting-approval" && p.manifest.expiresAt > this.now()) {
      challenge = randomBytes(32).toString("base64url");
      this.challenges.set(p.manifest.id, {
        owner,
        digest: p.digest,
        challenge,
        expiresAt: this.now() + EXACT.challengeTTL,
      });
    }
    return {
      plan: this.summary(p),
      manifest: structuredClone(p.manifest),
      rows: structuredClone(p.rows),
      journal: structuredClone(p.journal),
      approval: p.approval
        ? {
            owner: p.approval.owner,
            approvedAt: p.approval.approvedAt,
            expiresAt: p.approval.expiresAt,
          }
        : null,
      challenge,
      recovery: {
        automaticRollback: false,
        approvalRequired: true,
        warning:
          "Manual candidates only. Re-read current metadata; do not restore an old database or overwrite intervening edits. Use a separately authorized relationship-addition proposal.",
        entries: p.manifest.entries
          .filter((e, i) =>
            ["verified", "recovered"].includes(p.rows[i].status),
          )
          .map((e) => ({
            sceneId: e.sceneId,
            restoreOnlyTagIds: e.remove,
            expectedCurrentTags: e.after,
            expectedMetadataHash: e.metadataHash,
            originalTags: e.before,
          })),
      },
    };
  }
  async approve(owner, args) {
    object(args, ["planId", "digest", "challenge", "acknowledged"]);
    return this.serial(async () => {
      const p = this.get(owner, args.planId),
        c = this.challenges.get(args.planId);
      check(
        p.state === "awaiting-approval" && !p.approval,
        "EXACT_APPROVAL_REPLAY",
      );
      if (p.manifest.expiresAt <= this.now()) {
        p.state = "expired";
        await this.save(p, "expired");
        throw Error("EXACT_EXPIRED");
      }
      check(
        args.acknowledged === true &&
          args.digest === p.digest &&
          c?.owner === owner &&
          c.digest === p.digest &&
          c.challenge === args.challenge &&
          c.expiresAt > this.now(),
        "EXACT_REVIEW_REQUIRED",
      );
      check(this.canWrite() && !this.blocksWrites(), "EXACT_WRITES_BLOCKED");
      check(
        same(await this.adapter.environment(), p.manifest.environment),
        "EXACT_ENVIRONMENT_CHANGED",
      );
      this.challenges.delete(args.planId);
      const approval = {
        owner,
        planId: args.planId,
        digest: p.digest,
        approvedAt: this.now(),
        expiresAt: this.now() + EXACT.ttl,
        context: hash(c),
      };
      p.approval = { ...approval, mac: seal(this.key.key, approval) };
      p.state = "approved";
      await this.save(p, "authenticated-approval", { digest: p.digest });
      this.kick(p);
      return this.summary(p);
    });
  }
  blocksWrites() {
    return (
      !this.available ||
      [...this.plans.values()].some(
        (p) =>
          p.approval &&
          (p.rows.some((r) => ["intent", "failed"].includes(r.status)) ||
            ![
              "completed",
              "completed-with-skips",
              "expired",
              "invalidated",
            ].includes(p.state)),
      )
    );
  }
  kick(p) {
    if (!this.schedule || this.closing || this.timers.has(p.manifest.id))
      return;
    const timer = setTimeout(() => {
      this.timers.delete(p.manifest.id);
      this.tick(p.manifest.owner, p.manifest.id).catch(() => {});
    }, 200);
    timer.unref?.();
    this.timers.set(p.manifest.id, timer);
  }
  async control(owner, args) {
    object(args, ["planId", "action"]);
    check(["pause", "resume"].includes(args.action), "EXACT_ACTION_DENIED");
    const p = this.get(owner, args.planId);
    if (args.action === "pause") {
      check(
        ["approved", "executing", "paused"].includes(p.state),
        "EXACT_NOT_RUNNING",
      );
      this.pauses.add(args.planId);
    }
    return this.serial(async () => {
      const p = this.get(owner, args.planId);
      if (args.action === "pause") {
        if (["approved", "executing"].includes(p.state)) {
          p.state = "paused";
          await this.save(p, "user-paused");
        }
        return this.summary(p);
      }
      check(
        ["paused", "failed"].includes(p.state) &&
          p.approval &&
          !p.rows.some((r) => r.status === "failed"),
        "EXACT_RESUME_UNSAFE",
      );
      check(this.canWrite(), "EXACT_WRITES_BLOCKED");
      check(p.approval.expiresAt > this.now(), "EXACT_EXPIRED");
      this.pauses.delete(args.planId);
      p.error = null;
      p.state = "approved";
      await this.save(p, "user-resumed");
      this.kick(p);
      return this.summary(p);
    });
  }
  async tick(owner, id) {
    return this.serial(async () => {
      const p = this.get(owner, id);
      if (!["approved", "executing"].includes(p.state)) return this.summary(p);
      check(p.approval, "EXACT_APPROVAL_REQUIRED");
      try {
        if (p.approval.expiresAt <= this.now()) {
          p.state = "expired";
          await this.save(p, "approval-expired");
          return this.summary(p);
        }
        check(this.canWrite(), "EXACT_WRITES_BLOCKED");
        check(
          same(await this.adapter.environment(), p.manifest.environment),
          "EXACT_ENVIRONMENT_CHANGED",
        );
        p.state = "executing";
        await this.save(p, "batch-start");
        let processed = 0;
        for (let i = 0; i < p.rows.length && processed < EXACT.batch; i++) {
          const r = p.rows[i],
            e = p.manifest.entries[i];
          if (!["pending", "intent"].includes(r.status)) continue;
          if (this.closing || this.pauses.has(id)) {
            p.state = "paused";
            break;
          }
          check(this.canWrite(), "EXACT_WRITES_BLOCKED");
          check(p.approval.expiresAt > this.now(), "EXACT_EXPIRED");
          this.verify(p);
          processed++;
          let current;
          try {
            current = await this.adapter.scene(e.sceneId);
          } catch (err) {
            if (code(err) === "SCENE_NOT_FOUND" && r.status === "pending") {
              r.status = "skipped";
              r.reason = "SCENE_NOT_FOUND";
              await this.save(p, "scene-skipped", {
                operationId: r.operationId,
              });
              continue;
            }
            throw err;
          }
          const tags = sceneTags(current),
            protectedOK = hash(metadata(current)) === e.metadataHash;
          if (r.status === "intent") {
            r.observed = { tags, metadataHash: hash(metadata(current)) };
            r.status =
              protectedOK && same(tags, e.after) ? "recovered" : "failed";
            r.reason =
              r.status === "recovered"
                ? "EXACT_AFTER_OBSERVED_ATTRIBUTION_UNCERTAIN"
                : "EXACT_UNCERTAIN_NO_RETRY";
            await this.save(p, "intent-reconciled-read-only", {
              operationId: r.operationId,
            });
            if (r.status === "failed") throw Error(r.reason);
            continue;
          }
          if (!protectedOK || !same(tags, e.before)) {
            r.status = "skipped";
            r.reason = e.remove.every((t) => !tags.includes(t))
              ? "EXACT_ALREADY_ABSENT"
              : "EXACT_STALE_SOURCE";
            r.observed = { tags, metadataHash: hash(metadata(current)) };
            await this.save(p, "scene-skipped", {
              operationId: r.operationId,
              reason: r.reason,
            });
            continue;
          }
          const definitions = await this.definitions(e.before);
          if (
            !same(
              definitions,
              p.manifest.definitions
                .filter((t) => e.before.includes(t.id))
                .sort((a, b) => Number(a.id) - Number(b.id)),
            )
          ) {
            r.status = "skipped";
            r.reason = "EXACT_TAG_CHANGED_OR_MISSING";
            await this.save(p, "scene-skipped", {
              operationId: r.operationId,
              reason: r.reason,
            });
            continue;
          }
          r.status = "intent";
          r.attempts++;
          r.before = { tags, metadataHash: e.metadataHash };
          await this.save(p, "write-intent", {
            operationId: r.operationId,
            remove: e.remove,
          });
          let writeError = null;
          try {
            await this.adapter.remove(e.sceneId, e.remove);
          } catch (err) {
            writeError = code(err);
          }
          let after;
          try {
            after = await this.adapter.scene(e.sceneId);
          } catch (err) {
            r.reason = "EXACT_READBACK_UNAVAILABLE";
            r.writeError = writeError;
            throw Error(r.reason);
          }
          r.observed = {
            tags: sceneTags(after),
            metadataHash: hash(metadata(after)),
          };
          r.writeError = writeError;
          if (
            same(r.observed.tags, e.after) &&
            r.observed.metadataHash === e.metadataHash
          ) {
            r.status = "verified";
            r.reason = writeError
              ? "EXACT_VERIFIED_AFTER_WRITE_ERROR"
              : "EXACT_VERIFIED";
            await this.save(p, "scene-verified", {
              operationId: r.operationId,
              after: e.after,
            });
          } else {
            r.status = "failed";
            r.reason = "EXACT_READBACK_MISMATCH";
            await this.save(p, "scene-failed", { operationId: r.operationId });
            throw Error(r.reason);
          }
        }
        p.lastBatch = { at: this.now(), processed };
        if (p.state !== "paused") {
          p.state = p.rows.some((r) => ["pending", "intent"].includes(r.status))
            ? "executing"
            : p.rows.some((r) => ["skipped", "recovered"].includes(r.status))
              ? "completed-with-skips"
              : "completed";
        }
        await this.save(p, "batch-end", { ...p.lastBatch, state: p.state });
        if (p.state === "executing") this.kick(p);
      } catch (e) {
        p.state = "failed";
        p.error = code(e);
        if (this.available)
          await this.save(p, "execution-stopped", { error: p.error });
      }
      return this.summary(p);
    });
  }
  async close() {
    this.closing = true;
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
    await this.queue;
  }
}
