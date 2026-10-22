import { randomUUID, createHash } from "node:crypto";
import { object, string, integer, ids, check } from "./validation.mjs";
import {
  descriptorArgs,
  rawDescriptorState,
  ASSIGNMENT_FIELDS,
  sameDescriptorPlan,
} from "./descriptor-transactions.mjs";
import {
  uniqueIds,
  validateOperations,
  referencedIds,
  protectedTag,
  applyRelationship,
  fieldValue,
} from "./relationships.mjs";
const digest = (value) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const orderedGroups = (value) =>
  [...value].sort((a, b) => a.group_id.localeCompare(b.group_id));
const sameField = (k, a, b) =>
  equal(
    k === "groups" ? orderedGroups(a) : a,
    k === "groups" ? orderedGroups(b) : b,
  );
function guard(s) {
  const values = {
    ...s,
    tag_ids: fieldValue(s, "tag_ids"),
    studio_id: fieldValue(s, "studio_id"),
    groups: fieldValue(s, "groups"),
  };
  delete values.tags;
  delete values.studio;
  delete values.updated_at;
  values.groups = orderedGroups(values.groups);
  for (const key of ["performers", "galleries"])
    if (values[key]) values[key] = values[key].map((v) => v.id).sort();
  return Object.fromEntries(
    Object.entries(values).map(([k, v]) => [k, digest(v)]),
  );
}
const integrity = (p) =>
  digest({
    owner: p.owner,
    thread: p.thread,
    rows: p.rows,
    expiresAt: p.expiresAt,
    ...(p.schema === 2
      ? {
          summary: p.summary,
          operations: p.operations,
          selection: p.selection,
          entities: p.entities,
        }
      : {}),
    ...(p.schema === 3
      ? {
          kind: p.kind,
          id: p.id,
          command: p.descriptorCommand,
          plan: p.ownerPlan,
          preview: p.descriptorPreview,
          ownerVersion: p.ownerVersion,
          compensates: p.compensates,
          preservedCustomFields: p.preservedCustomFields,
        }
      : {}),
  });
export class Proposals {
  constructor({
    stash,
    store,
    descriptors,
    writesEnabled = false,
    now = Date.now,
  }) {
    Object.assign(this, { stash, store, descriptors, writesEnabled, now });
    this.queue = Promise.resolve();
    this.rows = [];
  }
  async init() {
    this.rows = await this.store.read("proposals.json", []);
    for (const p of this.rows)
      if (p.status === "applying") {
        p.status = "uncertain";
        p.error = "RESTART_DURING_APPLY";
      }
    await this.save();
  }
  save() {
    return this.store.write("proposals.json", this.rows);
  }
  serial(fn) {
    const r = this.queue.then(fn);
    this.queue = r.catch(() => {});
    return r;
  }
  public(p) {
    const result = { ...structuredClone(p), approvalHash: undefined };
    for (const row of result.rows) delete row.guard;
    delete result.descriptorCommand;
    delete result.ownerPlan;
    delete result.verifiedGuard;
    delete result.preservedCustomFields;
    return result;
  }
  list(owner, thread) {
    return this.rows
      .filter((p) => p.owner === owner && p.thread === thread)
      .map((p) => this.public(p));
  }
  async prepare(owner, thread, args) {
    return this.serial(async () => {
      object(args, ["sceneIds", "changes", "operations", "selection"]);
      const targets = uniqueIds(args.sceneIds, 5);
      check(
        !this.rows.some(
          (p) =>
            p.kind === "descriptor" &&
            ["applying", "uncertain"].includes(p.status) &&
            p.rows.some((r) => targets.includes(r.id)),
        ),
        "UNRESOLVED_DESCRIPTOR_OPERATION",
      );
      const operations =
        args.operations === undefined
          ? []
          : validateOperations(args.operations);
      const changes = structuredClone(
        args.changes === undefined ? {} : args.changes,
      );
      object(changes, ["title", "details", "rating100", "addTagIds"]);
      check(Object.keys(changes).length > 0 || operations.length > 0);
      check(
        !(
          changes.addTagIds && operations.some((o) => o.relationship === "tags")
        ),
        "DUPLICATE_TAG_OPERATION",
      );
      let selection;
      if (args.selection !== undefined) {
        // Counts are retrieved by the service, never accepted from model assertions.
        const result = await this.stash.findScenes(args.selection);
        check(
          targets.every((t) => result.scenes.some((s) => s.id === t)),
          "TARGET_OUTSIDE_SELECTION_PAGE",
        );
        selection = {
          filter: args.selection,
          matched: result.count,
          candidateCount: result.candidateCount,
          completeness: result.completeness,
          hasMore: result.hasMore,
        };
      }
      if ("title" in changes) string(changes.title, 500);
      if ("details" in changes) string(changes.details, 10000);
      if ("rating100" in changes && changes.rating100 !== null)
        integer(changes.rating100, 0, 100);
      if ("addTagIds" in changes)
        changes.addTagIds = uniqueIds(changes.addTagIds, 20);
      const entitySnapshots = [];
      if (changes.addTagIds) {
        const r = await this.stash.query(
          "query($ids:[ID!]){findTags(ids:$ids,filter:{per_page:30}){tags{id name aliases}}}",
          { ids: changes.addTagIds },
        );
        check(
          r.findTags.tags.length === changes.addTagIds.length,
          "TAG_NOT_FOUND",
        );
        check(!r.findTags.tags.some(protectedTag), "PROTECTED_TAG");
        entitySnapshots.push({ kind: "tags", values: r.findTags.tags });
      }
      const resolved = [];
      for (const op of operations) {
        const values = referencedIds(op);
        const entities = await this.stash.entitiesByIds(
          op.relationship === "studio" ? "studios" : op.relationship,
          values,
        );
        check(entities.length === values.length, "ENTITY_NOT_FOUND");
        if (op.relationship === "tags")
          check(!entities.some(protectedTag), "PROTECTED_TAG");
        resolved.push(entities);
        entitySnapshots.push({
          kind: op.relationship === "studio" ? "studios" : op.relationship,
          values: entities,
        });
      }
      const rows = [];
      for (const target of targets) {
        const s = this.stash.getSceneState
          ? await this.stash.getSceneState(target)
          : await this.stash.getScene({
              id: target,
              includeDetails: true,
            });
        const before = {},
          after = {};
        for (const [k, v] of Object.entries(changes)) {
          const field = k === "addTagIds" ? "tag_ids" : k;
          before[field] =
            field === "tag_ids" ? s.tags.map((t) => t.id).sort() : s[field];
          after[field] =
            field === "tag_ids"
              ? [...new Set([...before[field], ...v])].sort()
              : v;
        }
        const diffs = [],
          conflicts = [];
        for (let i = 0; i < operations.length; i++) {
          const r = applyRelationship(s, operations[i], resolved[i]);
          before[r.field] = r.before;
          after[r.field] = r.after;
          diffs.push(r.diff);
          if (r.conflict) conflicts.push(r.conflict);
        }
        const outcome = conflicts.length
          ? "conflict"
          : equal(before, after)
            ? "no_op"
            : "eligible";
        rows.push({
          id: target,
          label: s.title,
          updatedAt: s.updated_at,
          before,
          after,
          diffs,
          conflicts,
          outcome,
          guard: guard(s),
        });
      }
      const p = {
        schema: 2,
        id: randomUUID(),
        owner,
        thread,
        createdAt: this.now(),
        expiresAt: this.now() + 15 * 60 * 1000,
        status: rows.some((r) => r.outcome === "eligible")
          ? "pending"
          : rows.some((r) => r.outcome === "conflict")
            ? "conflict"
            : "no_op",
        rows,
        operations,
        selection,
        entities: entitySnapshots,
        summary: {
          matched: selection ? selection.matched : targets.length,
          evaluated: targets.length,
          eligible: rows.filter((r) => r.outcome === "eligible").length,
          alreadyCorrect: rows.filter((r) => r.outcome === "no_op").length,
          conflicts: rows.filter((r) => r.outcome === "conflict").length,
          included: rows.filter((r) => r.outcome === "eligible").length,
          targetIds: rows
            .filter((r) => r.outcome === "eligible")
            .map((r) => r.id),
          scope:
            "Eligibility evaluated only for these at most five targets; remaining matches are not approved",
        },
        scope: "Only listed fields; up to 5 scenes; non-atomic batch",
        recovery: "New compensating proposal required; never blind undo",
      };
      p.integrity = integrity(p);
      for (const old of this.rows)
        if (
          old.owner === owner &&
          old.thread === thread &&
          old.status === "pending"
        )
          old.status = "superseded";
      this.rows.push(p);
      await this.save();
      return {
        id: p.id,
        status: p.status,
        count: rows.length,
        summary: p.summary,
        conflicts: rows
          .filter((r) => r.conflicts.length)
          .map((r) => ({ id: r.id, conflicts: r.conflicts })),
        approvalRequired: p.status === "pending",
        writesAvailable: this.writesEnabled,
      };
    });
  }
  async decision(owner, thread, args) {
    return this.serial(async () => {
      object(args, ["id", "decision", "integrity"]);
      check(["approve", "reject", "cancel"].includes(args.decision));
      const p = this.rows.find((x) => x.id === args.id);
      check(p && p.owner === owner && p.thread === thread, "PROPOSAL_DENIED");
      check(args.integrity === p.integrity, "PROPOSAL_CHANGED");
      if (p.status !== "pending") return this.public(p); // Durable idempotency, including uncertain writes.
      if (args.decision !== "approve") {
        p.status = args.decision === "reject" ? "rejected" : "cancelled";
        await this.save();
        return this.public(p);
      }
      check(this.writesEnabled, "WRITES_DISABLED");
      check(p.expiresAt > this.now(), "PROPOSAL_EXPIRED");
      check(p.integrity === integrity(p), "PROPOSAL_CHANGED");
      check(
        !this.rows.some(
          (other) =>
            other.id !== p.id &&
            (p.kind === "descriptor" || other.kind === "descriptor") &&
            ["applying", "uncertain", "partial_or_uncertain"].includes(
              other.status,
            ) &&
            other.rows.some((r) => p.rows.some((target) => target.id === r.id)),
        ),
        "UNRESOLVED_DESCRIPTOR_OPERATION",
      );
      if (p.schema === 3) {
        check(p.kind === "descriptor", "PROPOSAL_CHANGED");
        return this.applyDescriptor(p);
      }
      // Preflight the whole batch before any write. The Stash API has no compare-and-swap.
      const eligible = p.rows.filter(
        (r) => !r.outcome || r.outcome === "eligible",
      );
      if (this.stash.entitiesByIds)
        for (const snapshot of p.entities || []) {
          const current = await this.stash.entitiesByIds(
            snapshot.kind,
            snapshot.values.map((e) => e.id),
          );
          const normalize = (rows) =>
            rows
              .map((e) => ({
                id: e.id,
                name: e.name,
                ...(snapshot.kind === "tags"
                  ? { aliases: e.aliases || [] }
                  : {}),
              }))
              .sort((a, b) => a.id.localeCompare(b.id));
          if (!equal(normalize(current), normalize(snapshot.values))) {
            p.status = "stale";
            await this.save();
            throw Error("PROPOSAL_STALE");
          }
        }
      for (const row of eligible) {
        const s = this.stash.getSceneState
          ? await this.stash.getSceneState(row.id)
          : await this.stash.getScene({
              id: row.id,
              includeDetails: true,
            });
        const current = {};
        for (const k of Object.keys(row.before)) current[k] = fieldValue(s, k);
        if (
          s.updated_at !== row.updatedAt ||
          !Object.entries(row.before).every(([k, v]) =>
            sameField(k, current[k], v),
          ) ||
          (row.guard && !equal(guard(s), row.guard))
        ) {
          p.status = "stale";
          await this.save();
          throw Error("PROPOSAL_STALE");
        }
      }
      p.status = "applying";
      p.approvedAt = this.now();
      p.approvalReference = randomUUID();
      p.results = [];
      await this.save();
      for (const row of eligible) {
        try {
          await this.stash.updateApproved({ id: row.id, ...row.after });
          const s = this.stash.getSceneState
            ? await this.stash.getSceneState(row.id)
            : await this.stash.getScene({
                id: row.id,
                includeDetails: true,
              });
          const verified =
            Object.entries(row.after).every(([k, v]) =>
              sameField(k, fieldValue(s, k), v),
            ) &&
            (!row.guard ||
              Object.entries(row.guard).every(
                ([k, v]) => k in row.after || guard(s)[k] === v,
              ));
          p.results.push({
            id: row.id,
            status: verified ? "verified" : "verification_failed",
          });
          await this.save();
          if (!verified) break;
        } catch {
          p.results.push({ id: row.id, status: "uncertain" });
          await this.save();
          break;
        }
      }
      p.status =
        p.results.length === eligible.length &&
        p.results.every((r) => r.status === "verified")
          ? "verified"
          : "partial_or_uncertain";
      p.finishedAt = this.now();
      await this.save();
      return this.public(p);
    });
  }
  async prepareDescriptors(owner, thread, args) {
    return this.serial(async () => {
      check(this.descriptors, "DESCRIPTOR_OWNER_UNAVAILABLE");
      object(args, ["sceneId", "add", "remove", "compensateId"]);
      let command, compensates;
      if (args.compensateId !== undefined) {
        check(Object.keys(args).length === 1, "INVALID_COMPENSATION");
        const old = this.rows.find(
          (p) =>
            p.id === args.compensateId &&
            p.owner === owner &&
            p.thread === thread &&
            p.kind === "descriptor",
        );
        check(
          old &&
            ["verified", "reconciled"].includes(old.status) &&
            old.integrity === integrity(old),
          "COMPENSATION_DENIED",
        );
        const scene = await this.stash.getSceneState(old.rows[0].id);
        check(
          equal(guard(scene), old.verifiedGuard) &&
            scene.updated_at === old.verifiedUpdatedAt,
          "COMPENSATION_STALE",
        );
        command = {
          sceneId: scene.id,
          add: old.ownerPlan.removed.map((d) => d.id),
          remove: old.ownerPlan.added.map((d) => d.id),
          restore: Object.fromEntries(
            ASSIGNMENT_FIELDS.map((k) => [k, old.ownerPlan.before.fields[k]]),
          ),
        };
        compensates = old.id;
      } else command = descriptorArgs(args);
      check(
        !this.rows.some(
          (p) =>
            ["applying", "uncertain", "partial_or_uncertain"].includes(
              p.status,
            ) && p.rows.some((r) => r.id === command.sceneId),
        ),
        "UNRESOLVED_DESCRIPTOR_OPERATION",
      );
      const { plan, ownerVersion } = await this.descriptors.preview(command, {
        withOwner: true,
      });
      const scene = await this.stash.getSceneState(command.sceneId);
      check(
        scene.updated_at === plan.before.updatedAt &&
          equal(rawDescriptorState(scene), plan.before.fields),
        "DESCRIPTOR_STALE",
      );
      const p = {
        schema: 3,
        kind: "descriptor",
        id: randomUUID(),
        owner,
        thread,
        ownerVersion,
        createdAt: this.now(),
        expiresAt: this.now() + 15 * 60 * 1000,
        status: plan.noOp ? "no_op" : "pending",
        descriptorCommand: { ...command, expected: plan.before },
        ownerPlan: plan,
        compensates,
        descriptorPreview: {
          current: plan.current,
          proposed: plan.proposed,
          added: plan.added,
          removed: plan.removed,
          unchanged: plan.current.filter(
            (d) => !plan.removed.some((r) => r.id === d.id),
          ),
          reviewEffect: "unchanged",
          operationCount: plan.operationCount,
        },
        rows: [
          {
            id: scene.id,
            label: scene.title,
            updatedAt: scene.updated_at,
            before: { descriptors: plan.current },
            after: { descriptors: plan.proposed },
            outcome: plan.noOp ? "no_op" : "eligible",
            guard: guard(scene),
          },
        ],
        scope:
          "One scene; only listed descriptor assignments. Review status and learning unchanged.",
        recovery:
          "Separate compensation requires current state to match verified result; no blind retry or undo",
      };
      const rest = { ...(scene.custom_fields || {}) };
      ASSIGNMENT_FIELDS.forEach((k) => delete rest[k]);
      p.preservedCustomFields = digest(rest);
      p.integrity = integrity(p);
      for (const old of this.rows)
        if (
          old.owner === owner &&
          old.thread === thread &&
          old.status === "pending"
        )
          old.status = "superseded";
      this.rows.push(p);
      await this.save();
      return {
        id: p.id,
        status: p.status,
        approvalRequired: p.status === "pending",
        writesAvailable: this.writesEnabled,
        preview: p.descriptorPreview,
      };
    });
  }
  descriptorResultMatches(p, scene) {
    if (!equal(rawDescriptorState(scene), p.ownerPlan.afterFields))
      return false;
    const original = p.rows[0].guard,
      current = guard(scene);
    // Full captured custom_fields except the two approved assignment keys.
    const beforeFields = p.preservedCustomFields;
    const rest = { ...(scene.custom_fields || {}) };
    ASSIGNMENT_FIELDS.forEach((k) => delete rest[k]);
    return (
      digest(rest) === beforeFields &&
      Object.entries(original).every(
        ([k, v]) => k === "custom_fields" || current[k] === v,
      )
    );
  }
  async applyDescriptor(p) {
    check(this.descriptors, "DESCRIPTOR_OWNER_UNAVAILABLE");
    const scene = await this.stash.getSceneState(p.rows[0].id);
    try {
      check(
        scene.updated_at === p.rows[0].updatedAt &&
          equal(guard(scene), p.rows[0].guard),
        "DESCRIPTOR_STALE",
      );
      const current = await this.descriptors.preview(p.descriptorCommand, {
        withOwner: true,
      });
      check(
        current.ownerVersion === p.ownerVersion &&
          sameDescriptorPlan(current.plan, p.ownerPlan),
        "DESCRIPTOR_STALE",
      );
    } catch (e) {
      p.status = "stale";
      p.error = "DESCRIPTOR_PREFLIGHT_FAILED";
      await this.save();
      throw e;
    }
    p.status = "applying";
    p.approvedAt = this.now();
    p.approvalReference = randomUUID();
    p.results = [];
    await this.save(); // Sole durable dispatch authority. NEVER retry after this point.
    let receipt = false;
    try {
      const result = await this.descriptors.apply(
        p.id,
        p.descriptorCommand,
        p.ownerPlan,
        p.ownerVersion,
      );
      receipt = result.status === "verified" && result.operationId === p.id;
    } catch {
      p.error = "DESCRIPTOR_OUTCOME_UNCERTAIN";
    }
    try {
      const after = await this.stash.getSceneState(p.rows[0].id);
      if (this.descriptorResultMatches(p, after)) {
        p.status = receipt ? "verified" : "reconciled";
        p.verifiedGuard = guard(after);
        p.verifiedUpdatedAt = after.updated_at;
        p.results = [
          {
            id: after.id,
            status: p.status,
            note: receipt
              ? "Owner receipt and independent fields verified"
              : "Expected state observed; dispatch receipt unavailable. Causation not established.",
          },
        ];
      } else {
        p.status = "uncertain";
        p.results = [{ id: p.rows[0].id, status: "verification_failed" }];
      }
    } catch {
      p.status = "uncertain";
      p.results = [{ id: p.rows[0].id, status: "readback_unavailable" }];
    }
    p.finishedAt = this.now();
    await this.save();
    return this.public(p);
  }
  async reconcileDescriptor(owner, thread, proposalId) {
    return this.serial(async () => {
      const p = this.rows.find(
        (p) => p.id === proposalId && p.owner === owner && p.thread === thread,
      );
      check(p, "PROPOSAL_DENIED");
      if (p.kind !== "descriptor" || p.status !== "uncertain") return;
      check(p.approvedAt && p.integrity === integrity(p), "PROPOSAL_CHANGED");
      try {
        const scene = await this.stash.getSceneState(p.rows[0].id);
        if (this.descriptorResultMatches(p, scene)) {
          p.status = "reconciled";
          p.verifiedGuard = guard(scene);
          p.verifiedUpdatedAt = scene.updated_at;
          p.results = [
            {
              id: scene.id,
              status: "reconciled",
              note: "Read-only recovery observed expected state; no mutation retried and no claim of causal attribution.",
            },
          ];
          await this.save();
        }
      } catch {
        /* Leave uncertain; no re-dispatch even when before-state is observed. */
      }
    });
  }
  async cancelThread(owner, thread) {
    return this.serial(async () => {
      for (const p of this.rows)
        if (p.owner === owner && p.thread === thread && p.status === "pending")
          p.status = "cancelled";
      await this.save();
    });
  }
}
