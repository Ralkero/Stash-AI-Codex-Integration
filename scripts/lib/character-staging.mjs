// Operator-only. Caller holds acquireInstance for the ENTIRE import/prepare.
import fs from "node:fs/promises";
import { check } from "../../service/validation.mjs";
import { hash, validateSource } from "../../service/exact-character-policy.mjs";
import {
  readSources,
  sourceName,
  SOURCE_INDEX,
  LEGACY_SOURCE,
} from "../../service/exact-character-sources.mjs";
export async function stageSource(engine, source) {
  validateSource(source);
  const { index, source: current } = await readSources(engine, source.owner);
  const digest = hash(source);
  const old = index || {
    schema: 1,
    owner: source.owner,
    active: hash(current),
    sources: [{ digest: hash(current), file: LEGACY_SOURCE }],
  };
  if (old.active === digest) return digest;
  check(
    !old.sources.some((r) => r.digest === digest),
    "EXACT_HISTORICAL_SOURCE_REACTIVATION",
  );
  check(old.sources.length < 16, "EXACT_SOURCE_LIMIT");
  check(
    [...engine.plans.values()].every((p) =>
      ["completed", "invalidated", "expired"].includes(p.state),
    ),
    "EXACT_OPERATION_OUTSTANDING",
  );
  const name = sourceName(digest),
    value = engine.wrap(source);
  // Exclusive create: interrupted staging may leave this identical orphan.
  // It is safe to adopt only after verifying its MAC and full content hash.
  try {
    const h = await fs.open(engine.store.filename(name), "wx", 0o600);
    try {
      await h.writeFile(JSON.stringify(value, null, 2));
      await h.sync();
    } finally {
      await h.close();
    }
  } catch (e) {
    if (e.code !== "EEXIST") throw e;
    const prior = engine.unwrap(await engine.store.read(name, null));
    check(hash(prior) === digest, "EXACT_SOURCE_INTEGRITY");
  }
  await engine.store.write(
    SOURCE_INDEX,
    engine.wrap({
      ...old,
      active: digest,
      sources: [...old.sources, { digest, file: name }],
    }),
  );
  return digest;
}
