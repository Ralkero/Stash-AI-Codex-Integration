import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { Store } from "../../service/store.mjs";
import { Stash } from "../../service/stash.mjs";
import { ExactCharacterAdapter } from "../../service/exact-character-adapter.mjs";
import { ExactCharacterCleanup } from "../../service/exact-character-cleanup.mjs";
import { acquireInstance } from "../../service/instance.mjs";
import { check } from "../../service/validation.mjs";
import { seal } from "../../service/tag-cleanup-policy.mjs";
import {
  same,
  hash,
  sourceMatches,
} from "../../service/exact-character-policy.mjs";
import { readSources } from "../../service/exact-character-sources.mjs";
import { stageSource } from "./character-staging.mjs";
import { auditedSource } from "./character-audit-source.mjs";
const sha = (b) => createHash("sha256").update(b).digest("hex");
export async function loadAudit(dir, expectedHash) {
  const raw = await fs.readFile(path.join(dir, "SHA256SUMS.json"));
  check(sha(raw) === expectedHash, "EXACT_IMPORT_HASH_MISMATCH");
  const hashes = JSON.parse(raw),
    data = {};
  for (const [name, h] of Object.entries(hashes)) {
    check(
      /^[a-zA-Z0-9.-]+$/.test(name) && !name.startsWith("."),
      "EXACT_AUDIT_PATH",
    );
    const b = await fs.readFile(path.join(dir, name));
    check(
      b.length < 64 * 1024 * 1024 && sha(b) === h,
      "EXACT_IMPORT_HASH_MISMATCH",
    );
    data[name] = name.endsWith(".json") ? JSON.parse(b) : b.toString("utf8");
  }
  for (const name of [
    "supported-removal-candidates.json",
    "scene-tag-association-audit.json",
    "native-tag-inventory.json",
    "reassignment-candidates.json",
    "recurrence-prevention-matrix.json",
    "canonical-definition-actions.json",
    "audit-coverage.json",
    "preservation-verification.json",
    "review.html",
    "FULL-LIBRARY-CHARACTER-AUDIT.md",
  ])
    check(data[name], "EXACT_AUDIT_FILE_MISSING");
  return { hashes, data };
}
export async function auditImport(args) {
  const [
    stateDir,
    auditDir,
    auditHash,
    policyFile,
    policyHash,
    ownerHash,
    registryHash,
    reference,
    outputDir,
  ] = args;
  check(args.length === 9 && reference, "EXACT_IMPORT_ARGUMENTS");
  const release = await acquireInstance(path.resolve(stateDir));
  let engine;
  try {
    const store = new Store(stateDir),
      control = await store.read("control.json", null);
    if (control?.pid) {
      let alive = true;
      try {
        process.kill(control.pid, 0);
      } catch (e) {
        if (e.code === "ESRCH") alive = false;
      }
      check(!alive, "EXACT_STOP_SERVICE_FIRST");
    }
    // Fail before init can alter an outstanding journal on restart.
    engine = new ExactCharacterCleanup({ store, adapter: {}, schedule: false });
    engine.key = await store.read("exact-character-key.json");
    const index = engine.unwrap(await store.read("exact-character-index.json"));
    const completedPairs = new Set();
    for (const id of index.plans) {
      const p = engine.unwrap(
        await store.read(`exact-character-plan-${id}.json`),
      );
      engine.verify(p);
      check(
        ["completed", "expired", "invalidated", "awaiting-approval"].includes(
          p.state,
        ) &&
          (!p.approval || p.state === "completed"),
        "EXACT_OPERATION_OUTSTANDING",
      );
      if (p.state === "completed")
        for (const e of p.manifest.entries)
          for (const t of e.remove) completedPairs.add(e.sceneId + ":" + t);
    }
    // Other executor state is not changed. Reject any unfinished authorized work.
    for (const n of await fs.readdir(stateDir))
      if (/^tag-plans-/.test(n) && n.endsWith(".json")) {
        const raw = await store.read(n),
          key = await store.read("tag-cleanup-key.json"),
          p = raw.value;
        check(raw.mac === seal(key.key, p), "EXACT_OTHER_STATE_CORRUPT");
        check(
          ![
            "approved",
            "executing",
            "running",
            "paused",
            "preflight",
            "pausing",
            "failed",
            "uncertain",
            "conflicted",
          ].includes(p.status) &&
            !Object.values(p.outcomes || {}).some((o) =>
              ["intent", "uncertain"].includes(o.status),
            ),
          "EXACT_OPERATION_OUTSTANDING",
        );
      }
    const global = await store.read("global-tag-state.json", null);
    if (global) {
      const key = await store.read("global-tag-key.json");
      check(
        global.mac === seal(key.key, global.value),
        "EXACT_OTHER_STATE_CORRUPT",
      );
      check(
        global.value.plans.every(
          (p) =>
            ![
              "preparing",
              "preflight",
              "deleting",
              "verifying",
              "uncertain",
              "failed",
            ].includes(p.status) &&
            (!p.intent || p.status === "completed"),
        ),
        "EXACT_OPERATION_OUTSTANDING",
      );
    }
    const proposals = await store.read("proposals.json", []);
    check(
      proposals.every(
        (p) =>
          ![
            "approved",
            "executing",
            "applying",
            "uncertain",
            "failed",
          ].includes(p.status),
      ),
      "EXACT_OPERATION_OUTSTANDING",
    );
    const policy = await fs.readFile(policyFile);
    check(sha(policy) === policyHash, "EXACT_IMPORT_HASH_MISMATCH");
    const { hashes, data } = await loadAudit(auditDir, auditHash);
    const ownerDir = path.join(
        os.homedir(),
        ".stash/plugins/scene-auto-tagger",
      ),
      code = await fs.readFile(path.join(ownerDir, "scene-auto-tagger.js")),
      registry = await fs.readFile(
        path.join(ownerDir, "identity-local-review.json"),
      );
    check(
      sha(code) === ownerHash && sha(registry) === registryHash,
      "EXACT_OWNER_PIN_MISMATCH",
    );
    const identity = createRequire(import.meta.url)(
      path.join(ownerDir, "scene-auto-tagger.js"),
    ).identityEligibility;
    const auth = await store.read("auth.json"),
      config = await store.read("config.json"),
      principal = auth?.principal || auth?.pairings?.[0]?.owner;
    check(principal && config, "EXACT_INSTALL_REQUIRED");
    const adapter = new ExactCharacterAdapter(
      new Stash({ url: config.stashUrl, apiKey: config.stashApiKey }),
    );
    adapter.remove = () => {
      throw Error("EXACT_IMPORT_READ_ONLY");
    };
    await adapter.environment();
    const result = await auditedSource({
      audit: data["scene-tag-association-audit.json"],
      candidates: data["supported-removal-candidates.json"],
      inventory: data["native-tag-inventory.json"],
      reassignments: data["reassignment-candidates.json"],
      completedPairs,
      adapter,
      identity,
      owner: principal,
      reference,
      reviewedAt: Date.parse(data["native-tag-inventory.json"].observedAt),
      admission: {
        kind: "reviewed-policy-audit-v1",
        policy: {
          id: "female-identities-only-v1",
          reference,
          documentHash: policyHash,
        },
        auditHashes: hashes,
        registryHash,
        ownerCodeHash: ownerHash,
      },
    });
    engine.adapter = adapter;
    await engine.init();
    check(engine.available, "EXACT_STORAGE_UNAVAILABLE");
    const { source: active } = await readSources(engine, principal);
    if (active.sourceHash === result.source.sourceHash) {
      check(
        same(active.admission, result.source.admission) &&
          same(
            active.rows.map((r) => [r.sceneId, r.before, r.remove, r.after]),
            result.source.rows.map((r) => [
              r.sceneId,
              r.before,
              r.remove,
              r.after,
            ]),
          ) &&
          active.rows.every((r, i) =>
            sourceMatches(r.observedState, result.source.rows[i].observedState),
          ),
        "EXACT_RETRY_SOURCE_CHANGED",
      );
      result.source = active;
    }
    await stageSource(engine, result.source);
    const plan = await engine.prepare(principal),
      p = engine.get(principal, plan.id);
    check(
      plan.state === "awaiting-approval" &&
        !plan.approved &&
        plan.verifiedRelationships === 0 &&
        p.rows.every((r) => r.attempts === 0 && r.status === "pending"),
      "EXACT_PREPARATION_ONLY",
    );
    await fs.mkdir(outputDir, { recursive: true });
    for (const [n, v] of Object.entries({
      "admission-validation.json": {
        sourceHash: result.source.sourceHash,
        auditHash,
        counts: plan,
        metadataWrites: 0,
      },
      "exact-candidate-crosswalk.json": result.crosswalk,
      "excluded-and-stale-candidates.json": result.excluded,
      "new-plan-summary.json": plan,
      "immutable-manifest.json": p.manifest,
      "empty-after-scenes.json": p.manifest.entries.filter(
        (e) => !e.after.length,
      ),
    })) {
      const target = path.join(outputDir, n);
      try {
        await fs.writeFile(target, JSON.stringify(v, null, 2), {
          flag: "wx",
          mode: 0o600,
        });
      } catch (e) {
        if (e.code !== "EEXIST") throw e;
        check(
          same(JSON.parse(await fs.readFile(target, "utf8")), v),
          "EXACT_INSPECTION_COPY_CONFLICT",
        );
      }
    }
    console.log(JSON.stringify(plan));
    return plan;
  } finally {
    if (engine) await engine.close();
    await release();
  }
}
