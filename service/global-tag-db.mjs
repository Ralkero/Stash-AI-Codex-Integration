// Local read-only SQLite safety projection. Production writes ONLY use Stash's
// native mutation. Every application table is guarded, not just visible fields.
import { DatabaseSync } from "node:sqlite";
import { hash, canonical } from "./tag-cleanup-policy.mjs";
import { check, id } from "./validation.mjs";
const quote = (s) => '"' + s.replaceAll('"', '""') + '"';
const rowsHash = (rows) => hash(rows.map(canonical).sort());
// Fingerprints can be signed 64-bit integers. Never round them through Number.
function readRows(db, name) {
  const stmt = db.prepare(`SELECT * FROM ${quote(name)}`);
  stmt.setReadBigInts(true);
  return stmt
    .all()
    .map((row) =>
      Object.fromEntries(
        Object.entries(row).map(([k, v]) => [
          k,
          typeof v === "bigint"
            ? v <= BigInt(Number.MAX_SAFE_INTEGER) &&
              v >= BigInt(Number.MIN_SAFE_INTEGER)
              ? Number(v)
              : { $sqliteInteger: v.toString() }
            : v instanceof Uint8Array
              ? { $sqliteBlob: Buffer.from(v).toString("base64") }
              : v,
        ]),
      ),
    );
}
const permitted = new Set([
  "scenes_tags",
  "images_tags",
  "tag_aliases",
  "tag_stash_ids",
  "tag_custom_fields",
]);
export function projectDatabase(filename, tagIds) {
  check(
    tagIds.length > 0 &&
      tagIds.length <= 200 &&
      new Set(tagIds).size === tagIds.length,
    "GLOBAL_TAG_LIMIT",
  );
  tagIds.forEach(id);
  const selected = new Set(tagIds);
  const db = new DatabaseSync(filename, { readOnly: true });
  try {
    db.exec("BEGIN"); // stable read transaction, not a write lock
    const schema = db
      .prepare(
        "SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_stat%' ORDER BY type,name",
      )
      .all();
    check(
      !schema.some((s) => s.type === "trigger"),
      "GLOBAL_UNAUDITED_TRIGGER",
    );
    const tables = schema.filter((s) => s.type === "table").map((s) => s.name);
    const all = {},
      fks = {};
    for (const name of tables) {
      all[name] = readRows(db, name);
      fks[name] = db.prepare(`PRAGMA foreign_key_list(${quote(name)})`).all();
    }
    const tags = all.tags.filter((r) => selected.has(String(r.id)));
    check(tags.length === tagIds.length, "GLOBAL_TAG_MISSING");
    // Saved filters are opaque application references: don't guess or repair them.
    check(
      all.saved_filters.length === 0,
      "GLOBAL_SAVED_FILTER_REVIEW_REQUIRED",
    );
    const after = {},
      removed = {},
      dependencies = [];
    for (const name of tables) {
      const refs = fks[name].filter((f) => f.table === "tags");
      const victims = all[name].filter((r) =>
        refs.some((f) => selected.has(String(r[f.from]))),
      );
      for (const f of refs)
        dependencies.push({
          table: name,
          column: f.from,
          onDelete: f.on_delete,
        });
      check(
        !victims.length || permitted.has(name),
        "GLOBAL_UNAPPROVED_RELATIONSHIP",
      );
      check(
        refs.every((f) => !victims.length || f.on_delete === "CASCADE"),
        "GLOBAL_UNEXPECTED_CASCADE",
      );
      removed[name] = name === "tags" ? tags : victims;
      const gone = new Set(removed[name]);
      after[name] = all[name].filter((r) => !gone.has(r));
    }
    const artwork = [...new Set(tags.map((t) => t.image_blob).filter(Boolean))];
    const removableBlobs = artwork.filter(
      (checksum) =>
        !tables.some((name) =>
          fks[name].some(
            (f) =>
              f.table === "blobs" &&
              after[name].some((r) => r[f.from] === checksum),
          ),
        ),
    );
    removed.blobs = all.blobs.filter((r) =>
      removableBlobs.includes(r.checksum),
    );
    after.blobs = all.blobs.filter((r) => !removableBlobs.includes(r.checksum));
    const beforeHashes = Object.fromEntries(
      tables.map((n) => [n, rowsHash(all[n])]),
    );
    const afterHashes = Object.fromEntries(
      tables.map((n) => [n, rowsHash(after[n])]),
    );
    db.exec("COMMIT");
    return {
      schemaHash: hash(schema),
      beforeHashes,
      afterHashes,
      tags,
      dependencies,
      artwork,
      removableBlobs,
      removed: Object.fromEntries(
        Object.entries(removed).filter(([, r]) => r.length),
      ),
      counts: {
        tags: tags.length,
        sceneAssignments: removed.scenes_tags.length,
        imageAssignments: removed.images_tags.length,
        scenes: new Set(removed.scenes_tags.map((r) => r.scene_id)).size,
        images: new Set(removed.images_tags.map((r) => r.image_id)).size,
        aliases: removed.tag_aliases.length,
        artwork: removableBlobs.length,
      },
      beforeDigest: hash({ schema: hash(schema), tables: beforeHashes }),
      afterDigest: hash({ schema: hash(schema), tables: afterHashes }),
    };
  } finally {
    db.close();
  }
}
// Post-write check cannot require the deleted IDs still exist.
export function databaseDigest(filename) {
  const db = new DatabaseSync(filename, { readOnly: true });
  try {
    db.exec("BEGIN");
    const schema = db
      .prepare(
        "SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_stat%' ORDER BY type,name",
      )
      .all();
    const tables = Object.fromEntries(
      schema
        .filter((s) => s.type === "table")
        .map((s) => [s.name, rowsHash(readRows(db, s.name))]),
    );
    db.exec("COMMIT");
    return hash({ schema: hash(schema), tables });
  } finally {
    db.close();
  }
}
