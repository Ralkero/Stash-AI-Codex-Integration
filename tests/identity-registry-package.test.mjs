import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
const manifest = JSON.parse(
  fs.readFileSync(
    new URL(
      "../integration/auto-tagger-0.9.26/new/scene-auto-tagger/identity-registry.json",
      import.meta.url,
    ),
    "utf8",
  ),
);
test("packaged identity registry has bounded public factual provenance", () => {
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.revision, "2026-10-22.1");
  assert.equal(manifest.records.length, 66);
  const trusted = new Set([
    "en.wikipedia.org",
    "wiki.leagueoflegends.com",
    "www.leagueoflegends.com",
    "overwatch.blizzard.com",
    "en.bandainamcoent.eu",
    "www.marvel.com",
    "www.dc.com",
  ]);
  for (const r of manifest.records) {
    assert.equal(r.category, "character");
    assert.equal(r.gender, "female");
    assert.ok(r.basis && r.franchise && r.sources.length);
    assert.ok(!r.tagId);
    for (const s of r.sources) {
      const u = new URL(s);
      assert.equal(u.protocol, "https:");
      assert.ok(trusted.has(u.hostname));
      assert.ok(!u.username && !u.password);
    }
  }
  assert.doesNotMatch(
    JSON.stringify(manifest),
    /localhost|127\.0\.0\.1|sceneIds|tag_ids/i,
  );
});
test("ambiguous labels are not promoted by the packaged registry", () => {
  const names = manifest.records.flatMap((r) => [r.canonical, ...r.aliases]);
  for (const name of [
    "Ashe",
    "Nami",
    "Nero",
    "Jane Doe",
    "Bayonetta",
    "Evelynn",
    "Ashley Graham",
    "Black Widow",
  ])
    assert.ok(!names.includes(name));
  assert.deepEqual(
    manifest.records.find((r) => r.canonical === "Emilie De Rochefort").aliases,
    ["Lili"],
  );
  assert.deepEqual(
    manifest.records.find((r) => r.canonical === "Susan Storm").aliases,
    ["Sue Storm"],
  );
});
