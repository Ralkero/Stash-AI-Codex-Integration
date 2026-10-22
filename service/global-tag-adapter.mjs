import fs from "node:fs/promises";
import { createReadStream } from "node:fs";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { check, id } from "./validation.mjs";
import { hash, same } from "./tag-cleanup-policy.mjs";
import { TagCleanupAdapter } from "./tag-cleanup-adapter.mjs";
import { projectDatabase, databaseDigest } from "./global-tag-db.mjs";
export async function fileHash(file) {
  const h = createHash("sha256");
  for await (const b of createReadStream(file)) h.update(b);
  return h.digest("hex");
}
async function files(root) {
  const result = [];
  async function walk(dir) {
    for (const e of await fs.readdir(dir, { withFileTypes: true })) {
      check(!e.isSymbolicLink(), "GLOBAL_SYMLINK_UNSUPPORTED");
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name !== "__pycache__") await walk(p);
      } else result.push(p);
    }
  }
  await walk(root);
  return result.sort();
}
export class GlobalTagAdapter {
  constructor({ stash, store, sceneCleanup }) {
    Object.assign(this, { stash, store, sceneCleanup });
    this.ownerAdapter = new TagCleanupAdapter(stash);
  }
  async seed() {
    const s = await this.store.read("global-tag-confirmation.json", null);
    check(
      s?.schema === 1 &&
        s.sourceDigest?.length === 64 &&
        s.confirmation?.confirmed === true &&
        s.confirmation.deletionApproved === false,
      "GLOBAL_CONFIRMATION_REQUIRED",
    );
    check(
      Array.isArray(s.tags) &&
        s.tags.length > 0 &&
        s.tags.length <= 200 &&
        new Set(s.tags.map((t) => t.id)).size === s.tags.length,
      "GLOBAL_CONFIRMATION_INVALID",
    );
    const stashRoot = path.join(os.homedir(), ".stash");
    check(
      path.resolve(s.database) === path.join(stashRoot, "stash-go.sqlite") &&
        path.resolve(s.blobs) === path.join(stashRoot, "blobs") &&
        path.resolve(s.plugins) === path.join(stashRoot, "plugins"),
      "GLOBAL_INSTALLATION_MISMATCH",
    );
    return s;
  }
  async evidence(seed) {
    const ownerRows = [];
    for (let i = 0; i < seed.tags.length; i += 50)
      ownerRows.push(
        ...(await this.ownerAdapter.tags(
          seed.tags.slice(i, i + 50).map((t) => t.id),
        )),
      );
    for (const t of ownerRows) {
      check(
        t.tag.name === seed.tags.find((s) => s.id === t.tag.id)?.name,
        "GLOBAL_IDENTITY_CHANGED",
      );
      check(
        t.owner.classification === "unknown" &&
          t.owner.reason === "unregistered" &&
          !t.tag.parents.length,
        "GLOBAL_CHARACTER_OR_DEPENDENCY",
      );
    }
    const decisions = [...this.sceneCleanup.jobs.values()].map((a) => ({
      id: a.id,
      decisions: a.decisions,
    }));
    check(
      !decisions.some((a) =>
        a.decisions.some(
          (d) =>
            d.choice === "character" && seed.tags.some((t) => t.id === d.tagId),
        ),
      ),
      "GLOBAL_CHARACTER_KEEP",
    );
    return { ownerHash: hash(ownerRows), decisionsHash: hash(decisions) };
  }
  async environment(seed) {
    const env = await this.ownerAdapter.environment();
    const r = await this.stash.query(
      "{configuration{general{databasePath blobsPath blobsStorage}}}",
    );
    check(
      path.resolve(r.configuration.general.databasePath) ===
        path.resolve(seed.database) &&
        path.resolve(r.configuration.general.blobsPath) ===
          path.resolve(seed.blobs) &&
        r.configuration.general.blobsStorage === "FILESYSTEM",
      "GLOBAL_INSTALLATION_MISMATCH",
    );
    const code = [];
    for (const p of await files(seed.plugins))
      if (/\.(js|mjs|py|yml|yaml|json|css|html)$/.test(p))
        code.push([path.relative(seed.plugins, p), await fileHash(p)]);
    return { env, pluginCode: hash(code) };
  }
  async backup(seed) {
    const b = seed.backup;
    check(
      b?.verified === true &&
        b.createdAt > 0 &&
        Date.now() - b.createdAt < 7 * 86400000,
      "GLOBAL_BACKUP_REQUIRED",
    );
    check((await fileHash(b.archive)) === b.sha256, "GLOBAL_BACKUP_CHANGED");
    const verification = JSON.parse(await fs.readFile(b.verification, "utf8"));
    check(
      hash(verification) === b.verificationHash &&
        verification.integrity === "ok" &&
        verification.foreignKeyErrors === 0 &&
        verification.archiveCRC === "ok",
      "GLOBAL_BACKUP_INVALID",
    );
    check(
      databaseDigest(verification.restoredCheckDatabase) === b.databaseDigest,
      "GLOBAL_RECOVERY_CHECK_CHANGED",
    );
    return {
      archive: b.archive,
      sha256: b.sha256,
      createdAt: b.createdAt,
      databaseDigest: b.databaseDigest,
      blobManifest: verification.blobManifest,
    };
  }
  async blobs(seed, expected, removed = []) {
    const actual = await files(seed.blobs);
    const expectedPaths = Object.keys(expected)
      .filter((n) => !removed.includes(path.basename(n)))
      .sort();
    const rel = actual
      .map((p) => "blobs/" + path.relative(seed.blobs, p).replaceAll("\\", "/"))
      .sort();
    check(same(rel, expectedPaths), "GLOBAL_BLOB_MEMBERSHIP_CHANGED");
    for (const name of expectedPaths)
      check(
        (await fileHash(path.join(seed.blobs, ...name.split("/").slice(1)))) ===
          expected[name].sha256,
        "GLOBAL_BLOB_CHANGED",
      );
  }
  project(seed) {
    return projectDatabase(
      seed.database,
      seed.tags.map((t) => t.id),
    );
  }
  digest(seed) {
    return databaseDigest(seed.database);
  }
  async destroyExact(ids) {
    check(
      Array.isArray(ids) &&
        ids.length > 0 &&
        ids.length <= 200 &&
        new Set(ids).size === ids.length,
      "GLOBAL_TAG_LIMIT",
    );
    ids.forEach(id);
    // ONLY write in this adapter. Called once, after durable approval + intent.
    // Native transaction removes Tag records/aliases/associations, never media.
    const r = await this.stash.query(
      "mutation($ids:[ID!]!){tagsDestroy(ids:$ids)}",
      { ids },
      { timeoutMs: 60000 },
    );
    check(r.tagsDestroy === true, "GLOBAL_DELETE_RESPONSE_INVALID");
  }
}
