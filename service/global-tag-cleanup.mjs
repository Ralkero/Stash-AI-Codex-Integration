// Separate, UI-only global Tag workflow. No model tools, implicit approval,
// automatic retry, or execution on startup. Old scene-only records are untouched.
import { randomUUID, randomBytes } from "node:crypto";
import { check, object, integer } from "./validation.mjs";
import { hash, seal, same } from "./tag-cleanup-policy.mjs";
export const GLOBAL_POLICY = 1;
const ttl = 24 * 60 * 60 * 1000;
export class GlobalTagCleanup {
  constructor({
    store,
    adapter,
    canWrite = () => false,
    emit = () => {},
    schedule = true,
    now = Date.now,
  }) {
    Object.assign(this, { store, adapter, canWrite, emit, schedule, now });
    this.available = false;
    this.plans = [];
    this.queue = Promise.resolve();
    this.pending = new Set();
    this.closing = false;
  }
  async init() {
    try {
      this.key = await this.store.read("global-tag-key.json", null);
      const doc = await this.store.read("global-tag-state.json", null);
      if (!doc) {
        check(!this.key, "GLOBAL_STATE_MISSING");
        this.key = { key: randomBytes(32).toString("hex") };
        await this.store.write("global-tag-key.json", this.key);
        await this.save();
      } else {
        check(
          this.key?.key?.length === 64 &&
            doc.mac === seal(this.key.key, doc.value) &&
            doc.value.schema === 1 &&
            doc.value.plans.length <= 16,
          "GLOBAL_STATE_CORRUPT",
        );
        this.plans = doc.value.plans;
      }
      for (const p of this.plans) {
        if (p.manifest)
          check(p.digest === hash(p.manifest), "GLOBAL_DIGEST_MISMATCH");
        if (
          ["preparing", "preflight", "deleting", "verifying"].includes(p.status)
        ) {
          p.status = p.intent ? "uncertain" : p.approval ? "stopped" : "failed";
          p.error = p.intent
            ? "Restart after durable deletion intent. Reconcile read-only; never retry."
            : "Interrupted before deletion; no automatic resume.";
        }
      }
      await this.save();
      this.available = true;
    } catch {
      this.available = false;
    }
  }
  async save(p) {
    try {
      const value = { schema: 1, plans: this.plans };
      check(
        Buffer.byteLength(JSON.stringify(value)) < 24 * 1024 * 1024,
        "GLOBAL_STATE_LIMIT",
      );
      await this.store.write("global-tag-state.json", {
        value,
        mac: seal(this.key.key, value),
      });
    } catch (e) {
      this.available = false;
      throw e;
    }
    if (p)
      this.emit(p.owner, { type: "global-tag-cleanup", threadId: p.thread });
  }
  serial(fn) {
    const p = this.queue.then(() => {
      check(this.available && !this.closing, "GLOBAL_UNAVAILABLE");
      return fn();
    });
    this.queue = p.catch(() => {});
    return p;
  }
  get(owner, thread, id) {
    check(this.available, "GLOBAL_UNAVAILABLE");
    const p = this.plans.find(
      (p) => p.id === id && p.owner === owner && p.thread === thread,
    );
    check(p, "GLOBAL_DENIED");
    return p;
  }
  blocksWrites() {
    return (
      !this.available ||
      this.plans.some(
        (p) =>
          p.approval &&
          (["preflight", "deleting", "verifying"].includes(p.status) ||
            (p.intent && p.status !== "completed")),
      )
    );
  }
  summary(p) {
    return {
      id: p.id,
      createdAt: p.createdAt,
      status: p.status,
      stage: p.stage,
      error: p.error || null,
      digest: p.digest || null,
      expiresAt: p.manifest?.expiresAt,
      counts: p.manifest?.projection.counts || null,
      approvalRecorded: !!p.approval,
      deletionDispatched: !!p.intent,
      backup: p.manifest?.backup || null,
      sourceDigest: p.manifest?.sourceDigest || null,
      classificationConfirmed: !!p.manifest,
      canApprove:
        p.status === "awaiting-approval" && this.now() < p.manifest.expiresAt,
      verified: p.status === "completed",
      stopRequested: !!p.stopRequested,
    };
  }
  list(owner, thread) {
    check(this.available, "GLOBAL_UNAVAILABLE");
    return {
      plans: this.plans
        .filter((p) => p.owner === owner && p.thread === thread)
        .map((p) => this.summary(p)),
    };
  }
  read(owner, thread, args) {
    object(args, ["planId", "page"]);
    const p = this.get(owner, thread, args.planId);
    const page = args.page ?? 1;
    integer(page, 1, 10000);
    const m = p.manifest;
    const rows = m
      ? Object.entries(m.projection.removed).flatMap(([table, rs]) =>
          rs.map((row) => ({ table, row })),
        )
      : [];
    return {
      plan: this.summary(p),
      tags: m?.tags || [],
      confirmation: m?.confirmation,
      scope: m?.scope,
      limitations: m?.limitations,
      artwork: m?.projection.removableBlobs || [],
      rows: rows.slice((page - 1) * 100, page * 100),
      page,
      count: rows.length,
    };
  }
  async prepare(owner, thread, args = {}) {
    object(args, []);
    return this.serial(async () => {
      const seed = await this.adapter.seed();
      check(seed.owner === owner && seed.thread === thread, "GLOBAL_DENIED");
      const existing = this.plans.find(
        (p) =>
          p.seedHash === hash(seed) &&
          [
            "preparing",
            "awaiting-approval",
            "preflight",
            "deleting",
            "verifying",
            "uncertain",
            "completed",
          ].includes(p.status),
      );
      if (existing) return this.summary(existing);
      check(
        !this.blocksWrites() && this.plans.length < 16,
        "GLOBAL_OPERATION_OUTSTANDING",
      );
      const p = {
        id: randomUUID(),
        owner,
        thread,
        createdAt: this.now(),
        seedHash: hash(seed),
        status: "preparing",
        stage: "Checking exact confirmed identities and backup",
        approval: null,
        intent: null,
      };
      this.plans.push(p);
      await this.save(p);
      this.kick(p);
      return this.summary(p);
    });
  }
  kick(p) {
    if (!this.schedule || this.closing || this.pending.has(p.id)) return;
    this.pending.add(p.id);
    setImmediate(() => {
      this.serial(() => this.step(p.id))
        .catch(() => {})
        .finally(() => this.pending.delete(p.id));
    });
  }
  async progress(p, stage) {
    p.stage = stage;
    await this.save(p);
  }
  async seedFor(p) {
    const s = await this.adapter.seed();
    check(hash(s) === p.seedHash, "GLOBAL_CONFIRMATION_CHANGED");
    return s;
  }
  async step(id) {
    const p = this.plans.find((p) => p.id === id);
    if (!p || !["preparing", "preflight"].includes(p.status)) return;
    try {
      const seed = await this.seedFor(p);
      const env = await this.adapter.environment(seed),
        evidence = await this.adapter.evidence(seed);
      await this.progress(
        p,
        "Verifying recovery archive and saved Character decisions",
      );
      const backup = await this.adapter.backup(seed);
      await this.adapter.blobs(seed, backup.blobManifest);
      const projection = this.adapter.project(seed);
      check(
        projection.beforeDigest === backup.databaseDigest,
        "GLOBAL_BACKUP_STALE",
      );
      check(
        projection.tags.every((t) =>
          seed.tags.some((s) => s.id === String(t.id) && s.name === t.name),
        ),
        "GLOBAL_IDENTITY_CHANGED",
      );
      if (p.status === "preparing") {
        p.manifest = {
          schema: GLOBAL_POLICY,
          operation: "delete-exact-global-tags",
          id: p.id,
          owner: p.owner,
          thread: p.thread,
          createdAt: p.createdAt,
          expiresAt: this.now() + ttl,
          sourceDigest: seed.sourceDigest,
          seedHash: p.seedHash,
          tags: seed.tags,
          confirmation: seed.confirmation,
          environment: env,
          evidence,
          projection,
          backup: {
            archive: backup.archive,
            sha256: backup.sha256,
            createdAt: backup.createdAt,
            databaseDigest: backup.databaseDigest,
          },
          scope:
            "Delete these exact global Tag records, their intrinsic aliases/custom data and the enumerated scene/image associations and unshared tag artwork. Preserve all other metadata and source media.",
          limitations: [
            "Auto-Tagger is unchanged; labels may recur.",
            "Do not edit metadata, play scenes, run scans or Auto-Tagger during approval/execution. Native Stash has no atomic compare-and-delete API; an external writer can race the final check. Drift is rejected or reported as uncertain, never silently accepted.",
            "Native deletion is one database transaction. After dispatch, Stop cannot undo it. Artwork deletion is not transactional; verified database + blob backup is required for recovery.",
            "Restore is explicit/manual, never automatic; a full restore rolls back later library changes.",
          ],
        };
        p.digest = hash(p.manifest);
        p.status = "awaiting-approval";
        p.stage = "Exact plan ready. No deletion approved or dispatched.";
        await this.save(p);
        return;
      }
      check(
        p.approval?.mac ===
          seal(this.key.key, {
            id: p.id,
            digest: p.digest,
            owner: p.owner,
            thread: p.thread,
            at: p.approval.at,
            operation: "delete-exact-global-tags",
          }),
        "GLOBAL_APPROVAL_INVALID",
      );
      check(
        this.now() < p.manifest.expiresAt && p.digest === hash(p.manifest),
        "GLOBAL_EXPIRED_OR_CHANGED",
      );
      check(
        same(env, p.manifest.environment) &&
          same(evidence, p.manifest.evidence),
        "GLOBAL_ENVIRONMENT_CHANGED",
      );
      check(same(projection, p.manifest.projection), "GLOBAL_METADATA_CHANGED");
      check(!p.intent, "GLOBAL_NO_RETRY");
      if (p.stopRequested) {
        p.status = "stopped";
        p.stage = "Stopped before deletion.";
        await this.save(p);
        return;
      }
      check(this.canWrite(), "GLOBAL_WRITES_BLOCKED");
      await this.progress(
        p,
        "Preflight passed; preparing durable exact deletion intent",
      );
      // Last database guard directly before dispatch, after all slow backup work.
      check(
        this.adapter.digest(seed) === p.manifest.projection.beforeDigest,
        "GLOBAL_METADATA_CHANGED",
      );
      if (p.stopRequested || this.closing) {
        p.status = "stopped";
        await this.save(p);
        return;
      }
      p.intent = {
        at: this.now(),
        digest: p.digest,
        ids: seed.tags.map((t) => t.id),
      };
      p.status = "deleting";
      await this.save(p); // no write if durable intent cannot be recorded
      check(this.canWrite() && !this.closing, "GLOBAL_WRITES_BLOCKED");
      let responseLost = false;
      try {
        await this.adapter.destroyExact(p.intent.ids);
      } catch {
        responseLost = true;
      }
      p.status = "verifying";
      await this.progress(
        p,
        "Verifying all database tables and retained artwork",
      );
      check(
        this.adapter.digest(seed) === p.manifest.projection.afterDigest,
        "GLOBAL_READBACK_MISMATCH",
      );
      await this.adapter.blobs(
        seed,
        backup.blobManifest,
        projection.removableBlobs,
      );
      p.status = "completed";
      p.completedAt = this.now();
      p.stage = responseLost
        ? "Expected result verified after lost response; no causal claim. No retry was sent."
        : "All approved deletions and all retained metadata verified.";
      p.responseLost = responseLost;
      await this.save(p);
    } catch (e) {
      p.status = p.intent ? "uncertain" : p.approval ? "conflicted" : "failed";
      p.error = /^[A-Z_]+$/.test(e.message) ? e.message : "GLOBAL_CHECK_FAILED";
      p.stage = p.intent
        ? "Deletion result requires read-only reconciliation. No retry will be sent."
        : "Stopped before deletion.";
      if (this.available) await this.save(p);
    }
  }
  async approve(owner, thread, args) {
    object(args, ["planId", "digest", "acknowledge"]);
    return this.serial(async () => {
      const p = this.get(owner, thread, args.planId);
      check(
        args.digest === p.digest &&
          args.acknowledge === "DELETE EXACT GLOBAL TAGS",
        "GLOBAL_CONFIRMATION_REQUIRED",
      );
      if (p.approval) return this.summary(p);
      check(
        p.status === "awaiting-approval" && this.now() < p.manifest.expiresAt,
        "GLOBAL_NOT_APPROVABLE",
      );
      check(!this.blocksWrites() && this.canWrite(), "GLOBAL_WRITES_BLOCKED");
      const at = this.now();
      p.approval = {
        at,
        mac: seal(this.key.key, {
          id: p.id,
          digest: p.digest,
          owner,
          thread,
          at,
          operation: "delete-exact-global-tags",
        }),
      };
      p.status = "preflight";
      p.stage =
        "Approval recorded. Checking backup and metadata before deletion.";
      await this.save(p);
      this.kick(p);
      return this.summary(p);
    });
  }
  async control(owner, thread, args) {
    object(args, ["planId", "action"]);
    check(["stop", "reconcile"].includes(args.action));
    const p = this.get(owner, thread, args.planId);
    if (args.action === "stop") {
      check(!p.intent && p.status !== "completed", "GLOBAL_ALREADY_DISPATCHED");
      p.stopRequested = true;
    }
    return this.serial(async () => {
      if (args.action === "stop") {
        if (!p.intent) {
          p.status = "stopped";
          p.stage = "Stopped before deletion; no automatic resume.";
        }
        await this.save(p);
      } else {
        check(p.intent && p.status === "uncertain", "GLOBAL_NOT_RECONCILABLE");
        const s = await this.seedFor(p),
          b = await this.adapter.backup(s);
        check(
          this.adapter.digest(s) === p.manifest.projection.afterDigest,
          "GLOBAL_READBACK_MISMATCH",
        );
        await this.adapter.blobs(
          s,
          b.blobManifest,
          p.manifest.projection.removableBlobs,
        );
        p.status = "completed";
        p.stage =
          "Expected state verified by read-only reconciliation. No retry or causal claim.";
        p.error = null;
        await this.save(p);
      }
      return this.summary(p);
    });
  }
  async close() {
    this.closing = true;
    for (const p of this.plans)
      if (!p.intent && p.status === "preflight") p.stopRequested = true;
    await this.queue;
  }
}
