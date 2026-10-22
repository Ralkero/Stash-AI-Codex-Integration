import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { DatabaseSync } from "node:sqlite";
import { projectDatabase, databaseDigest } from "../service/global-tag-db.mjs";
async function fixture(t) {
  const dir = await fs.mkdtemp(
    path.join(os.tmpdir(), "stash-global-db-fixture-"),
  );
  const file = path.join(dir, "fixture.sqlite");
  // Only generated fixtures are ever writable; the production projection is read-only.
  const db = new DatabaseSync(file);
  db.exec(`PRAGMA foreign_keys=ON;
 CREATE TABLE blobs(checksum TEXT PRIMARY KEY,blob BLOB);
 CREATE TABLE tags(id INTEGER PRIMARY KEY,name TEXT,image_blob TEXT REFERENCES blobs(checksum));
 CREATE TABLE scenes(id INTEGER PRIMARY KEY,title TEXT);
 CREATE TABLE images(id INTEGER PRIMARY KEY,title TEXT);
 CREATE TABLE scenes_tags(scene_id INTEGER REFERENCES scenes(id),tag_id INTEGER REFERENCES tags(id) ON DELETE CASCADE);
 CREATE TABLE images_tags(image_id INTEGER REFERENCES images(id),tag_id INTEGER REFERENCES tags(id) ON DELETE CASCADE);
 CREATE TABLE tag_aliases(tag_id INTEGER REFERENCES tags(id) ON DELETE CASCADE,alias TEXT);
 CREATE TABLE saved_filters(id INTEGER PRIMARY KEY,filter TEXT);
 CREATE TABLE audios_tags(audio_id INTEGER,tag_id INTEGER REFERENCES tags(id) ON DELETE CASCADE);
 INSERT INTO blobs VALUES ('a',NULL),('shared',NULL);
 INSERT INTO tags VALUES(7,'Franchise','a'),(8,'Character','shared'),(9,'Other franchise','shared');
 INSERT INTO scenes VALUES(1,'preserve title');INSERT INTO images VALUES(1,'preserve image');
 INSERT INTO scenes_tags VALUES(1,7),(1,8);INSERT INTO images_tags VALUES(1,7),(1,8);
 INSERT INTO tag_aliases VALUES(7,'alias');`);
  t.after(() => db.close());
  return { db, file };
}
test("read-only projection matches cascade deletion in disposable DB and protects shared artwork", async (t) => {
  const { db, file } = await fixture(t);
  const p = projectDatabase(file, ["7", "9"]);
  assert.equal(p.beforeDigest, databaseDigest(file));
  assert.deepEqual(p.removableBlobs, ["a"]);
  db.exec(
    "BEGIN;UPDATE tags SET image_blob=NULL WHERE id IN(7,9);DELETE FROM blobs WHERE checksum='a';DELETE FROM tags WHERE id IN(7,9);COMMIT;",
  );
  assert.equal(databaseDigest(file), p.afterDigest);
  assert.equal(
    db.prepare("SELECT title FROM scenes").get().title,
    "preserve title",
  );
  assert.equal(db.prepare("SELECT tag_id FROM scenes_tags").get().tag_id, 8);
});
test("unapproved Audio relationship, saved filter, and trigger each fail closed", async (t) => {
  const { db, file } = await fixture(t);
  db.exec("INSERT INTO audios_tags VALUES(1,7)");
  assert.throws(
    () => projectDatabase(file, ["7"]),
    /GLOBAL_UNAPPROVED_RELATIONSHIP/,
  );
  db.exec("DELETE FROM audios_tags;INSERT INTO saved_filters VALUES(1,'{}')");
  assert.throws(
    () => projectDatabase(file, ["7"]),
    /GLOBAL_SAVED_FILTER_REVIEW_REQUIRED/,
  );
  db.exec(
    "DELETE FROM saved_filters;CREATE TRIGGER bad AFTER DELETE ON tags BEGIN DELETE FROM scenes;END",
  );
  assert.throws(() => projectDatabase(file, ["7"]), /GLOBAL_UNAUDITED_TRIGGER/);
});
test("unrelated metadata drift and duplicate/missing IDs are detected", async (t) => {
  const { db, file } = await fixture(t);
  const p = projectDatabase(file, ["7"]);
  db.exec("UPDATE scenes SET title='changed'");
  assert.notEqual(databaseDigest(file), p.beforeDigest);
  assert.throws(() => projectDatabase(file, ["7", "7"]), /GLOBAL_TAG_LIMIT/);
  assert.throws(() => projectDatabase(file, ["77"]), /GLOBAL_TAG_MISSING/);
});
test("64-bit fingerprints are preserved exactly without numeric rounding", async (t) => {
  const { db, file } = await fixture(t);
  db.exec(
    "CREATE TABLE fingerprints(value INTEGER); INSERT INTO fingerprints VALUES(-2482420545983163774)",
  );
  const p = projectDatabase(file, ["7"]);
  assert.equal(databaseDigest(file), p.beforeDigest);
  db.exec("UPDATE fingerprints SET value=-2482420545983163773");
  assert.notEqual(databaseDigest(file), p.beforeDigest);
});
