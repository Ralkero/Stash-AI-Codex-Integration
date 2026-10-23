// Administrative local import. Stop the companion first. NEVER approves/applies.
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { Store } from "../service/store.mjs";
import { Stash } from "../service/stash.mjs";
import { ExactCharacterAdapter } from "../service/exact-character-adapter.mjs";
import { ExactCharacterCleanup } from "../service/exact-character-cleanup.mjs";
import { seal } from "../service/tag-cleanup-policy.mjs";
import { reviewedSource } from "./lib/character-source.mjs";
import { check } from "../service/validation.mjs";
const [
  stateDir,
  input,
  expectedInputHash,
  planPath,
  expectedPlanHash,
  reference,
] = process.argv.slice(2);
check(stateDir && input && planPath && reference, "EXACT_IMPORT_ARGUMENTS");
const store = new Store(path.resolve(stateDir)),
  control = await store.read("control.json", null);
if (control?.pid) {
  let live = false;
  try {
    process.kill(control.pid, 0);
    live = true;
  } catch {}
  check(!live, "EXACT_STOP_SERVICE_FIRST");
}
const raw = await fs.readFile(input),
  plan = await fs.readFile(planPath),
  digest = (b) => createHash("sha256").update(b).digest("hex");
check(
  digest(raw) === expectedInputHash && digest(plan) === expectedPlanHash,
  "EXACT_IMPORT_HASH_MISMATCH",
);
const auth = await store.read("auth.json", null),
  config = await store.read("config.json", null);
// Match Auth.init's legacy principal resolution without rewriting credentials.
const principal = auth?.principal || auth?.pairings?.[0]?.owner;
check(principal && config, "EXACT_INSTALL_REQUIRED");
const source = reviewedSource(JSON.parse(raw), JSON.parse(plan), {
  owner: principal,
  reference,
  sourceHash: expectedInputHash,
});
const engine = new ExactCharacterCleanup({
  store,
  adapter: new ExactCharacterAdapter(
    new Stash({ url: config.stashUrl, apiKey: config.stashApiKey }),
  ),
  schedule: false,
});
await engine.init();
check(engine.available, "EXACT_STORAGE_UNAVAILABLE");
const old = await store.read("exact-character-source.json", null);
check(!old, "EXACT_SOURCE_ALREADY_STAGED");
await store.write("exact-character-source.json", {
  value: source,
  mac: seal(engine.key.key, source),
});
const result = await engine.prepare(principal);
await engine.close();
check(
  !result.approved && result.state === "awaiting-approval",
  "EXACT_PREPARATION_ONLY",
);
console.log(JSON.stringify(result));
