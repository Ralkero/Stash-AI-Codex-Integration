// Read-only source selection. Only the stopped-service operator importer stages.
import { check, object } from "./validation.mjs";
import { hash, validateSource } from "./exact-character-policy.mjs";
import fs from "node:fs/promises";
export const SOURCE_INDEX = "exact-character-sources.json";
export const LEGACY_SOURCE = "exact-character-source.json";
export const sourceName = (digest) => {
  check(/^[a-f0-9]{64}$/.test(digest), "EXACT_SOURCE_DIGEST");
  return `exact-character-source-${digest}.json`;
};
export async function readSources(engine, owner) {
  const signed = await engine.store.read(SOURCE_INDEX, null);
  if (!signed) {
    if (engine.store.dir)
      check(
        !(await fs.readdir(engine.store.dir)).some((n) =>
          /^exact-character-source-[a-f0-9]{64}\.json$/.test(n),
        ),
        "EXACT_SOURCE_INDEX_MISSING",
      );
    const source = engine.unwrap(await engine.store.read(LEGACY_SOURCE, null));
    validateSource(source);
    check(source.owner === owner, "EXACT_DENIED");
    return { index: null, source };
  }
  const index = engine.unwrap(signed);
  object(index, ["schema", "owner", "active", "sources"]);
  check(
    index.schema === 1 && index.owner === owner,
    "EXACT_SOURCE_INDEX_INVALID",
  );
  check(
    Array.isArray(index.sources) &&
      index.sources.length > 0 &&
      index.sources.length <= 16 &&
      new Set(index.sources.map((r) => r.digest)).size === index.sources.length,
    "EXACT_SOURCE_INDEX_INVALID",
  );
  let source;
  for (const entry of index.sources) {
    object(entry, ["digest", "file"]);
    check(
      entry.file === sourceName(entry.digest) || entry.file === LEGACY_SOURCE,
      "EXACT_SOURCE_INDEX_INVALID",
    );
    const s = engine.unwrap(await engine.store.read(entry.file, null));
    validateSource(s);
    check(
      s.owner === owner && hash(s) === entry.digest,
      "EXACT_SOURCE_INTEGRITY",
    );
    if (entry.digest === index.active) source = s;
  }
  check(source, "EXACT_SOURCE_INDEX_INVALID");
  return { index, source };
}
