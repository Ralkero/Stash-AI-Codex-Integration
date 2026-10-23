import { randomUUID, randomBytes } from "node:crypto";
import { check, object, choice, integer, id } from "./validation.mjs";
import {
  LIMITS,
  POLICY,
  hash,
  seal,
  same,
  tagIds,
  protectedState,
  classifyTag,
  normalize,
  RECURRENCE_PROTECTED_TAGS,
} from "./tag-cleanup-policy.mjs";
const uuid = (v) =>
  check(
    typeof v === "string" && /^[0-9a-f-]{36}$/.test(v),
    "CLEANUP_ID_INVALID",
  );
const file = (kind, id) => `tag-${kind}-${id}.json`;
const nowISO = () => new Date().toISOString();
// Durable single-writer state machine. A timer only advances approved, exact
// operations; restart never restarts writes. No model-facing execution method.
export class TagCleanup {
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
    this.jobs = new Map();
    this.plans = new Map();
    this.timers = new Map();
    this.available = false;
    this.closing = false;
  }
  async init() {
    try {
      this.index = await this.store.read("tag-cleanup-index.json", null);
      this.key = await this.store.read("tag-cleanup-key.json", null);
      if (!this.index) {
        check(!this.key, "CLEANUP_INDEX_MISSING");
        this.key = { key: randomBytes(32).toString("hex") };
        await this.store.write("tag-cleanup-key.json", this.key);
        this.index = { schema: 1, audits: [], plans: [] };
        await this.saveIndex();
      } else {
        check(this.key?.key?.length === 64, "CLEANUP_KEY_MISSING");
        check(
          this.index.schema === 1 &&
            Array.isArray(this.index.audits) &&
            Array.isArray(this.index.plans),
          "CLEANUP_INDEX_INVALID",
        );
        check(
          this.index.audits.length <= LIMITS.jobs &&
            this.index.plans.length <= LIMITS.plans &&
            new Set([...this.index.audits, ...this.index.plans]).size ===
              this.index.audits.length + this.index.plans.length,
          "CLEANUP_CAPACITY",
        );
        check(
          this.index.mac ===
            seal(this.key.key, {
              schema: this.index.schema,
              audits: this.index.audits,
              plans: this.index.plans,
            }),
          "CLEANUP_INDEX_CORRUPT",
        );
      }
      for (const kind of ["audits", "plans"]) {
        for (const key of this.index[kind]) {
          uuid(key);
          const d = await this.store.read(file(kind, key), null);
          check(
            d && d.mac === seal(this.key.key, d.value),
            "CLEANUP_STATE_CORRUPT",
          );
          check(
            d.value.id === key && d.value.schema === 1,
            "CLEANUP_STATE_CORRUPT",
          );
          const value = d.value;
          (kind === "audits" ? this.jobs : this.plans).set(key, value);
          if (
            kind === "plans" &&
            ["running", "preflight", "pausing", "approved"].includes(
              value.status,
            )
          ) {
            value.status = "paused";
            value.error = "RESTART_REQUIRES_READ_ONLY_RECONCILIATION";
            await this.save(kind, value);
          }
          if (kind === "audits" && value.status === "running") {
            value.status = "paused";
            value.error = "Restart: resume read-only audit";
            await this.save(kind, value);
          }
          if (kind === "plans" && value.status === "preparing") {
            value.status = "failed";
            value.error = "Preparation interrupted; create a new plan";
            await this.save(kind, value);
          }
        }
      }
      this.available = true;
    } catch {
      this.error = "CLEANUP_STORAGE_UNAVAILABLE";
      this.available = false;
    }
  }
  serial(fn) {
    const p = this.queue.then(() => {
      check(this.available, "CLEANUP_STORAGE_UNAVAILABLE");
      return fn();
    });
    this.queue = p.catch(() => {});
    return p;
  }
  async saveIndex() {
    try {
      this.index.mac = seal(this.key.key, {
        schema: this.index.schema,
        audits: this.index.audits,
        plans: this.index.plans,
      });
      await this.store.write("tag-cleanup-index.json", this.index);
    } catch (e) {
      this.available = false;
      this.error = "CLEANUP_STORAGE_UNAVAILABLE";
      throw e;
    }
  }
  async save(kind, value) {
    try {
      check(
        Buffer.byteLength(JSON.stringify(value)) <= LIMITS.bytes,
        "CLEANUP_STORAGE_LIMIT",
      );
      await this.store.write(file(kind, value.id), {
        value,
        mac: seal(this.key.key, value),
      });
    } catch (e) {
      this.available = false;
      this.error = "CLEANUP_STORAGE_UNAVAILABLE";
      throw e;
    }
    this.emit(value.owner, { type: "tag-cleanup", threadId: value.thread });
  }
  get(kind, owner, thread, key) {
    check(this.available, "CLEANUP_STORAGE_UNAVAILABLE");
    uuid(key);
    const v = (kind === "audits" ? this.jobs : this.plans).get(key);
    check(v && v.owner === owner && v.thread === thread, "CLEANUP_DENIED");
    return v;
  }
  async add(kind, v) {
    await this.save(kind, v);
    this.index[kind].push(v.id);
    await this.saveIndex();
    (kind === "audits" ? this.jobs : this.plans).set(v.id, v);
  }
  list(owner, thread) {
    check(this.available, "CLEANUP_STORAGE_UNAVAILABLE");
    return {
      audits: [...this.jobs.values()]
        .filter((a) => a.owner === owner && a.thread === thread)
        .map((a) => this.auditSummary(a)),
      plans: [...this.plans.values()]
        .filter((p) => p.owner === owner && p.thread === thread)
        .map((p) => this.planSummary(p)),
    };
  }
  blocksWrites(exceptId = null) {
    return [...this.plans.values()].some(
      (p) =>
        p.id !== exceptId &&
        p.approval &&
        (["running", "paused", "uncertain", "conflicted"].includes(p.status) ||
          Object.values(p.outcomes).some((o) =>
            ["intent", "uncertain"].includes(o.status),
          )),
    );
  }
  auditSummary(a) {
    return {
      id: a.id,
      status: a.status,
      scope: "All native scenes; two ID-cursor passes, not an atomic snapshot",
      createdAt: a.createdAt,
      observedAt: a.observedAt,
      total: a.total,
      scenes: a.rows.length,
      tagged: a.rows.filter((r) => r.tags.length).length,
      untagged: a.rows.filter((r) => !r.tags.length).length,
      distinctTags: a.tagIds.length,
      classified: a.tags.length,
      associations: a.associations,
      pages: a.pages,
      reconciled: a.verifyIndex || 0,
      error: a.error || null,
      counts: a.tags.reduce((v, t) => {
        v[t.category] = (v[t.category] || 0) + 1;
        return v;
      }, {}),
      complete: a.status === "complete",
      revision: a.revision,
      inheritedDecisions: a.decisions.filter((d) => d.sourceAuditId).length,
      decisionWarnings: a.decisionWarnings || [],
    };
  }
  planSummary(p) {
    const counts = Object.values(p.outcomes).reduce((v, o) => {
      v[o.status] = (v[o.status] || 0) + 1;
      return v;
    }, {});
    counts.pending = p.targets.length - Object.keys(p.outcomes).length;
    const verified = p.manifest.rows.filter((r) =>
      ["verified", "reconciled"].includes(p.outcomes[r.id]?.status),
    );
    return {
      id: p.id,
      auditId: p.auditId,
      revision: p.revision,
      currentAuditRevision: this.jobs.get(p.auditId)?.revision ?? null,
      approvalBlock:
        p.status === "awaiting-approval" &&
        this.jobs.get(p.auditId)?.revision !== p.revision
          ? "CLEANUP_DECISION_CHANGED"
          : null,
      status: p.status,
      createdAt: p.createdAt,
      expiresAt: p.expiresAt,
      digest: p.digest || null,
      scenes: p.manifest.rows.length,
      relationships: p.manifest.rows.reduce((n, r) => n + r.remove.length, 0),
      prepared: p.manifest.rows.length,
      expectedScenes: p.targets.length,
      tagIds: p.manifest.tags.map((t) => t.tag.id),
      counts,
      verifiedRelationships: verified.reduce((n, r) => n + r.remove.length, 0),
      errorSceneId: p.errorSceneId || null,
      error: p.error || null,
      approval: p.approval
        ? { at: p.approval.at, operation: p.approval.operation }
        : null,
      operation: "remove_scene_tag_assignments",
      noGlobalTagDeletion: true,
      noSceneDeletion: true,
      recurrencePrevention:
        ["0.9.24", "0.9.25", "0.9.26", "0.9.27", "0.9.28"].includes(
          p.manifest.environment.owner,
        ) &&
        p.manifest.tags.every(
          (t) =>
            t.eligible && RECURRENCE_PROTECTED_TAGS[t.tag.id] === t.tag.name,
        )
          ? {
              status: "verified-at-preparation",
              ownerVersion: p.manifest.environment.owner,
              tagIds: p.manifest.tags.map((t) => t.tag.id),
              explanation:
                "The audited Auto-Tagger prevents new scene assignments of these exact identities. Approval rechecks the owner and environment. Other external writers are not covered.",
            }
          : null,
    };
  }
  kick(kind, key) {
    if (
      !this.schedule ||
      this.closing ||
      this.timers.has(key) ||
      !this.available
    )
      return;
    const timer = setTimeout(() => {
      this.timers.delete(key);
      this.serial(() =>
        kind === "audits" ? this.auditStep(key) : this.planStep(key),
      )
        .catch(() => {})
        .finally(() => {
          const v = (kind === "audits" ? this.jobs : this.plans).get(key);
          if (v && ["running", "preparing"].includes(v.status))
            this.kick(kind, key);
        });
    }, 50);
    this.timers.set(key, timer);
  }
  decisionCandidates(owner, thread) {
    const latest = new Map();
    for (const prior of [...this.jobs.values()]
      .filter(
        (v) =>
          v.owner === owner && v.thread === thread && v.status === "complete",
      )
      .sort((x, y) => x.createdAt - y.createdAt)) {
      for (const decision of prior.decisions) {
        const item = prior.tags.find((t) => t.tag.id === decision.tagId);
        if (
          item &&
          (!latest.has(decision.tagId) ||
            decision.at >= latest.get(decision.tagId).decision.at)
        ) {
          latest.set(decision.tagId, {
            decision: structuredClone(decision),
            sourceAuditId: prior.id,
            tag: { ...structuredClone(item.tag), matches: undefined },
            owner: structuredClone(item.owner),
          });
        }
      }
    }
    return [...latest.values()].sort(
      (x, y) => Number(x.decision.tagId) - Number(y.decision.tagId),
    );
  }
  async start(owner, thread, args) {
    object(args, []);
    return this.serial(async () => {
      check(this.index.audits.length < LIMITS.jobs, "CLEANUP_CAPACITY");
      check(
        ![...this.jobs.values()].some((a) => a.status === "running"),
        "AUDIT_ALREADY_RUNNING",
      );
      const env = await this.adapter.environment();
      // Same authenticated owner and conversation only. Freeze the latest explicit
      // decision per identity; no model inference, migration or historical edits.
      const inherited = this.decisionCandidates(owner, thread);
      const a = {
        schema: 1,
        id: randomUUID(),
        owner,
        thread,
        status: "running",
        stage: "scan",
        createdAt: this.now(),
        observedAt: nowISO(),
        environment: env,
        total: null,
        rows: [],
        tagIds: [],
        tags: [],
        associations: 0,
        pages: 0,
        cursor: 0,
        verifyIndex: 0,
        verifyCursor: 0,
        revision: 0,
        decisions: [],
        inheritedCandidates: inherited,
        decisionWarnings: [],
      };
      await this.add("audits", a);
      this.kick("audits", a.id);
      return this.auditSummary(a);
    });
  }
  async resumeAudit(owner, thread, args) {
    object(args, ["auditId"]);
    return this.serial(async () => {
      const a = this.get("audits", owner, thread, args.auditId);
      check(["paused", "failed"].includes(a.status), "AUDIT_NOT_RESUMABLE");
      check(
        ![...this.jobs.values()].some((x) => x.status === "running"),
        "AUDIT_ALREADY_RUNNING",
      );
      check(
        same(a.environment, await this.adapter.environment()),
        "AUDIT_ENVIRONMENT_CHANGED",
      );
      a.status = "running";
      a.error = null;
      await this.save("audits", a);
      this.kick("audits", a.id);
      return this.auditSummary(a);
    });
  }
  async auditStep(key) {
    const a = this.jobs.get(key);
    if (a.status !== "running") return;
    try {
      if (a.stage === "scan") {
        const p = await this.adapter.page(a.cursor);
        check(
          a.total === null || a.total === p.total,
          "AUDIT_COVERAGE_CHANGED",
        );
        a.total = p.total;
        check(a.total <= LIMITS.scenes, "AUDIT_SCENE_LIMIT");
        check(
          a.rows.length + p.remaining === a.total,
          "AUDIT_COVERAGE_CHANGED",
        );
        if (!p.rows.length) {
          check(a.rows.length === a.total, "AUDIT_INCOMPLETE");
          a.studios = await this.adapter.catalog("studios");
          a.groups = await this.adapter.catalog("groups");
          a.stage = "classify";
        } else {
          const additions = p.rows.reduce((n, r) => n + r.tags.length, 0);
          const tags = [
            ...new Set([...a.tagIds, ...p.rows.flatMap((r) => r.tags)]),
          ].sort((x, y) => Number(x) - Number(y));
          check(
            tags.length <= LIMITS.tags &&
              a.associations + additions <= LIMITS.associations,
            "AUDIT_CAPACITY",
          );
          a.rows.push(...p.rows);
          a.tagIds = tags;
          a.associations += additions;
          a.cursor = Number(p.rows.at(-1).id);
          a.pages++;
        }
      } else if (a.stage === "classify") {
        const ids = a.tagIds.slice(
          a.tags.length,
          a.tags.length + LIMITS.tagPage,
        );
        if (ids.length) {
          const data = await this.adapter.tags(ids);
          for (const t of data) {
            const previous = a.inheritedCandidates?.find(
              (v) => v.decision.tagId === t.tag.id,
            );
            let decision;
            if (previous) {
              // Compare actual native/owner evidence, not an envelope version hash.
              // Compatible owner releases may change version without changing facts.
              if (same(previous.tag, t.tag) && same(previous.owner, t.owner)) {
                decision = {
                  ...previous.decision,
                  evidence: t.evidence,
                  sourceAuditId: previous.sourceAuditId,
                };
                a.decisions.push(decision);
                a.revision++;
              } else {
                a.decisionWarnings.push({
                  tagId: t.tag.id,
                  reason:
                    "Saved decision evidence changed; excluded until explicitly reviewed.",
                });
              }
            }
            t.tag.matches = [
              ...a.studios
                .filter((v) => normalize(v.name) === normalize(t.tag.name))
                .map((v) => ({ kind: "Franchise", id: v.id, name: v.name })),
              ...a.groups
                .filter((v) => normalize(v.name) === normalize(t.tag.name))
                .map((v) => ({ kind: "Author", id: v.id, name: v.name })),
            ].slice(0, 20);
            a.tags.push({
              ...t,
              ...classifyTag(t.tag, t.owner, decision),
              ...(previous && !decision
                ? {
                    category: "ambiguous",
                    eligible: false,
                    reason:
                      "Saved decision evidence changed; excluded until explicitly reviewed.",
                  }
                : {}),
              sceneIds: a.rows
                .filter((r) => r.tags.includes(t.tag.id))
                .map((r) => r.id),
            });
          }
        } else {
          a.stage = "verify";
          delete a.studios;
          delete a.groups;
        }
      } else {
        const p = await this.adapter.page(a.verifyCursor);
        check(p.total === a.total, "AUDIT_COVERAGE_CHANGED");
        check(
          a.verifyIndex + p.remaining === a.total,
          "AUDIT_COVERAGE_CHANGED",
        );
        check(
          same(
            p.rows,
            a.rows.slice(a.verifyIndex, a.verifyIndex + p.rows.length),
          ),
          "AUDIT_SCENE_CHANGED",
        );
        a.verifyIndex += p.rows.length;
        if (p.rows.length) a.verifyCursor = Number(p.rows.at(-1).id);
        else {
          check(a.verifyIndex === a.total, "AUDIT_INCOMPLETE");
          check(
            !a.inheritedCandidates ||
              same(
                a.inheritedCandidates,
                this.decisionCandidates(a.owner, a.thread),
              ),
            "AUDIT_DECISIONS_CHANGED",
          );
          check(
            same(a.environment, await this.adapter.environment()),
            "AUDIT_ENVIRONMENT_CHANGED",
          );
          a.status = "complete";
          a.observedAt = nowISO();
        }
      }
      await this.save("audits", a);
    } catch (e) {
      a.status = "failed";
      a.error = String(e.message).slice(0, 140);
      if (this.available) await this.save("audits", a);
    }
  }
  read(owner, thread, args) {
    object(args, ["auditId", "planId", "page", "tagId", "sceneId"]);
    check(Boolean(args.auditId) !== Boolean(args.planId));
    const page = integer(args.page ?? 1, 1, 10000);
    if (args.auditId) {
      const a = this.get("audits", owner, thread, args.auditId);
      const t = args.tagId
        ? a.tags.find((t) => t.tag.id === id(args.tagId))
        : null;
      if (args.tagId) check(t, "TAG_NOT_IN_AUDIT");
      return {
        audit: this.auditSummary(a),
        ...(t
          ? {
              tag: { ...this.candidateView(a, t), sceneIds: undefined },
              sceneIds: t.sceneIds.slice((page - 1) * 50, page * 50),
              count: t.sceneIds.length,
            }
          : {
              candidates: a.tags.slice((page - 1) * 20, page * 20).map((t) => ({
                ...this.candidateView(a, t),
                sceneIds: undefined,
                assignments: t.sceneIds.length,
                examples: t.sceneIds.slice(0, 3),
              })),
              count: a.tags.length,
            }),
        page,
      };
    }
    const p = this.get("plans", owner, thread, args.planId);
    const rows = args.sceneId
      ? p.manifest.rows.filter((r) => r.id === id(args.sceneId))
      : p.manifest.rows;
    return {
      plan: this.planSummary(p),
      page,
      count: rows.length,
      rows: rows.slice((page - 1) * 20, page * 20).map(({ guard, ...r }) => ({
        ...r,
        outcome: p.outcomes[r.id] || { status: "pending" },
      })),
    };
  }
  candidateView(a, t) {
    // Presentation-only correction for an early .11.1 explanation. Never mutate
    // saved audit evidence or frozen manifests to repair display text.
    if (
      ["0.9.24", "0.9.25", "0.9.26", "0.9.27", "0.9.28"].includes(
        a.environment.owner,
      ) &&
      t.eligible &&
      t.category === "confirmed-non-character" &&
      RECURRENCE_PROTECTED_TAGS[t.tag.id] === t.tag.name
    )
      return {
        ...t,
        reason:
          "Explicit user non-Character decision. The audited Auto-Tagger prevents new scene assignments of this exact identity. This is not cleanup approval.",
      };
    return t;
  }
  async classify(owner, thread, args) {
    object(args, ["auditId", "tagId", "choice", "evidence"]);
    choice(args.choice, ["character", "non-character", "undecided"]);
    return this.serial(async () => {
      const a = this.get("audits", owner, thread, args.auditId);
      check(a.status === "complete", "AUDIT_INCOMPLETE");
      const t = a.tags.find((t) => t.tag.id === id(args.tagId));
      check(t && t.evidence === args.evidence, "TAG_EVIDENCE_CHANGED");
      const fresh = (await this.adapter.tags([t.tag.id]))[0];
      check(fresh.evidence === t.evidence, "TAG_EVIDENCE_CHANGED");
      const d = {
        tagId: t.tag.id,
        choice: args.choice,
        evidence: t.evidence,
        at: this.now(),
      };
      check(a.decisions.length < 2000, "CLEANUP_CAPACITY");
      a.decisions.push(d);
      Object.assign(t, classifyTag(t.tag, t.owner, d));
      a.revision++;
      await this.save("audits", a);
      return this.auditSummary(a);
    });
  }
  async prepare(owner, thread, args) {
    object(args, ["auditId", "tagIds"]);
    const selected = tagIds(args.tagIds);
    check(selected.length > 0 && selected.length <= 50);
    return this.serial(async () => {
      check(this.index.plans.length < LIMITS.plans, "CLEANUP_CAPACITY");
      check(
        ![...this.plans.values()].some((p) =>
          ["running", "preparing"].includes(p.status),
        ),
        "CLEANUP_BUSY",
      );
      const a = this.get("audits", owner, thread, args.auditId);
      check(a.status === "complete", "AUDIT_INCOMPLETE");
      const tags = selected.map((v) => a.tags.find((t) => t.tag.id === v));
      check(
        tags.every((t) => t?.eligible),
        "CLEANUP_CANDIDATE_BLOCKED",
      );
      check(
        same(a.environment, await this.adapter.environment()),
        "CLEANUP_ENVIRONMENT_CHANGED",
      );
      const targets = a.rows.filter((r) =>
        r.tags.some((v) => selected.includes(v)),
      );
      check(targets.length > 0, "CLEANUP_EMPTY");
      const p = {
        schema: 1,
        id: randomUUID(),
        owner,
        thread,
        auditId: a.id,
        revision: a.revision,
        status: "preparing",
        createdAt: this.now(),
        expiresAt: this.now() + LIMITS.ttl,
        targets: structuredClone(targets),
        outcomes: {},
        events: [],
        manifest: {
          operation: "remove_scene_tag_assignments",
          policy: POLICY,
          environment: a.environment,
          tags: structuredClone(tags.map(({ sceneIds, ...t }) => t)),
          rows: [],
        },
      };
      await this.add("plans", p);
      this.kick("plans", p.id);
      return this.planSummary(p);
    });
  }
  digest(p) {
    return hash({
      id: p.id,
      owner: p.owner,
      thread: p.thread,
      auditId: p.auditId,
      revision: p.revision,
      createdAt: p.createdAt,
      expiresAt: p.expiresAt,
      manifest: p.manifest,
    });
  }
  async validatePlan(p) {
    check(p.digest && p.digest === this.digest(p), "CLEANUP_MANIFEST_CHANGED");
    check(p.expiresAt > this.now(), "CLEANUP_EXPIRED");
    const a = this.jobs.get(p.auditId);
    check(a?.revision === p.revision, "CLEANUP_DECISION_CHANGED");
    check(
      same(p.manifest.environment, await this.adapter.environment()),
      "CLEANUP_ENVIRONMENT_CHANGED",
    );
    const fresh = await this.adapter.tags(p.manifest.tags.map((t) => t.tag.id));
    check(
      fresh.every((t, i) => t.evidence === p.manifest.tags[i].evidence),
      "TAG_EVIDENCE_CHANGED",
    );
  }
  async planStep(key) {
    const p = this.plans.get(key);
    let currentRow = null;
    try {
      if (p.status === "preparing") {
        for (const target of p.targets.slice(
          p.manifest.rows.length,
          p.manifest.rows.length + LIMITS.batch,
        )) {
          const s = await this.adapter.scene(target.id);
          check(
            s.id === target.id &&
              same(tagIds(s.tags.map((t) => t.id)), target.tags) &&
              s.updated_at === target.updatedAt,
            "CLEANUP_SCENE_CHANGED",
          );
          const remove = target.tags.filter((v) =>
            p.manifest.tags.some((t) => t.tag.id === v),
          );
          p.manifest.rows.push({
            id: s.id,
            before: target.tags,
            remove,
            after: target.tags.filter((v) => !remove.includes(v)),
            updatedAt: s.updated_at,
            guard: protectedState(s),
            observedAt: nowISO(),
          });
        }
        if (p.manifest.rows.length === p.targets.length) {
          p.digest = this.digest(p);
          await this.validatePlan(p);
          p.status = "awaiting-approval";
        }
        await this.save("plans", p);
        return;
      }
      if (p.status !== "running") return;
      check(this.canWrite(), "CLEANUP_WRITES_DISABLED");
      check(
        this.now() - p.runStarted < LIMITS.duration,
        "CLEANUP_RUN_TIME_LIMIT",
      );
      check(
        p.approval?.digest === p.digest &&
          p.approval.mac ===
            seal(this.key.key, {
              id: p.id,
              digest: p.digest,
              owner: p.owner,
              thread: p.thread,
              at: p.approval.at,
              operation: p.manifest.operation,
            }),
        "CLEANUP_APPROVAL_INVALID",
      );
      await this.validatePlan(p);
      const row = p.manifest.rows.find((r) => !p.outcomes[r.id]);
      if (!row) {
        check(
          Object.values(p.outcomes).every((o) =>
            ["verified", "reconciled"].includes(o.status),
          ),
          "CLEANUP_INCOMPLETE",
        );
        p.status = "completed";
        await this.save("plans", p);
        return;
      }
      currentRow = row;
      const before = await this.adapter.scene(row.id);
      check(
        before.id === row.id &&
          same(tagIds(before.tags.map((t) => t.id)), row.before) &&
          before.updated_at === row.updatedAt &&
          protectedState(before) === row.guard,
        "CLEANUP_PREFLIGHT_CONFLICT",
      );
      // Durable intent MUST finish before the only write; failures never replay.
      p.outcomes[row.id] = { status: "intent", at: this.now() };
      await this.save("plans", p);
      let responseLost = false;
      try {
        await this.adapter.remove(row.id, row.remove);
      } catch {
        responseLost = true;
      }
      let after;
      try {
        after = await this.adapter.scene(row.id);
      } catch {
        p.outcomes[row.id] = {
          status: "uncertain",
          at: this.now(),
          reason: "Readback unavailable",
        };
        p.status = "uncertain";
        await this.save("plans", p);
        return;
      }
      const good =
        after.id === row.id &&
        same(tagIds(after.tags.map((t) => t.id)), row.after) &&
        protectedState(after) === row.guard;
      p.outcomes[row.id] = {
        status: good ? (responseLost ? "reconciled" : "verified") : "uncertain",
        at: this.now(),
        reason: responseLost
          ? "Expected state observed after lost response; causation not proven"
          : good
            ? "Authoritative readback matched"
            : "Readback did not match approved result",
      };
      if (!good) p.status = "uncertain";
      await this.save("plans", p);
    } catch (e) {
      p.status = p.status === "preparing" ? "failed" : "conflicted";
      p.error = String(e.message).slice(0, 140);
      if (currentRow) {
        p.errorSceneId = currentRow.id;
        if (!p.outcomes[currentRow.id])
          p.outcomes[currentRow.id] = {
            status: "conflicted",
            at: this.now(),
            reason: p.error,
          };
      }
      if (this.available) await this.save("plans", p);
    }
  }
  async approve(owner, thread, args) {
    object(args, ["planId", "digest"]);
    return this.serial(async () => {
      const p = this.get("plans", owner, thread, args.planId);
      check(args.digest === p.digest, "CLEANUP_DIGEST_MISMATCH");
      if (p.approval) return this.planSummary(p);
      check(!this.blocksWrites(p.id), "CLEANUP_OPERATION_OUTSTANDING");
      check(
        p.status === "awaiting-approval" && this.canWrite(),
        "CLEANUP_NOT_APPROVABLE",
      );
      await this.validatePlan(p);
      const at = this.now();
      p.approval = {
        at,
        digest: p.digest,
        operation: p.manifest.operation,
        mac: seal(this.key.key, {
          id: p.id,
          digest: p.digest,
          owner,
          thread,
          at,
          operation: p.manifest.operation,
        }),
      };
      p.events.push({ action: "approve", at, owner, thread, digest: p.digest });
      p.status = "running";
      p.runStarted = this.now();
      await this.save("plans", p);
      this.kick("plans", p.id);
      return this.planSummary(p);
    });
  }
  async control(owner, thread, args) {
    object(args, ["planId", "action"]);
    choice(args.action, ["pause", "stop", "resume", "reconcile"]);
    return this.serial(async () => {
      const p = this.get("plans", owner, thread, args.planId);
      check(p.events.length < 500, "CLEANUP_CAPACITY");
      check(p.approval, "CLEANUP_NOT_APPROVED");
      if (args.action === "stop") {
        check(p.status !== "completed", "CLEANUP_COMPLETED");
        p.status = "cancelled";
      }
      if (args.action === "pause") {
        check(p.status === "running", "CLEANUP_NOT_RUNNING");
        p.status = "paused";
      }
      if (args.action === "reconcile") {
        check(
          ["paused", "uncertain", "conflicted", "cancelled"].includes(p.status),
          "CLEANUP_NOT_RECONCILABLE",
        );
        for (const row of p.manifest.rows.filter((r) =>
          ["intent", "uncertain"].includes(p.outcomes[r.id]?.status),
        )) {
          const s = await this.adapter.scene(row.id);
          p.outcomes[row.id] = {
            status:
              s.id === row.id &&
              same(tagIds(s.tags.map((t) => t.id)), row.after) &&
              protectedState(s) === row.guard
                ? "reconciled"
                : "uncertain",
            at: this.now(),
            reason: "Read-only reconciliation; no retry or causal claim",
          };
        }
        await this.save("plans", p);
      }
      if (args.action === "resume") {
        check(
          ["paused", "uncertain"].includes(p.status),
          "CLEANUP_NOT_RESUMABLE",
        );
        check(
          Object.values(p.outcomes).every((o) =>
            ["verified", "reconciled"].includes(o.status),
          ),
          "CLEANUP_UNCERTAIN_NO_RETRY",
        );
        await this.validatePlan(p);
        check(this.canWrite(), "CLEANUP_WRITES_DISABLED");
        p.status = "running";
        p.runStarted = this.now();
      }
      p.events.push({ action: args.action, at: this.now(), owner, thread });
      await this.save("plans", p);
      if (p.status === "running") this.kick("plans", p.id);
      return this.planSummary(p);
    });
  }
  async close() {
    this.closing = true;
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
    await this.queue;
  }
}
