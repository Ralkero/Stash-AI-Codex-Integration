// Explicit one-time cutover metadata; never copies Codex history or credentials.
import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { Runtime } from "../service/runtime.mjs";
import { validateRuntimeHome } from "../service/runtime-home.mjs";
const state = process.argv[2],
  legacyHome = process.argv[3];
assert.ok(
  state && path.isAbsolute(state) && legacyHome && path.isAbsolute(legacyHome),
  "Usage: node scripts/prepare-isolated-storage.mjs <absolute state> <verified legacy home>",
);
await validateRuntimeHome(path.join(state, "codex-home"), { isolated: true });
await validateRuntimeHome(legacyHome);
const file = path.join(state, "runtime-storage.json");
assert.equal(
  await fs.stat(file).then(
    () => true,
    (e) => {
      if (e.code === "ENOENT") return false;
      throw e;
    },
  ),
  false,
  "Cutover manifest already exists; do not overwrite",
);
const original = await fs.readFile(path.join(state, "conversations.json"));
const chats = JSON.parse(original);
assert.ok(chats.every((c) => !c.storage));
assert.equal(new Set(chats.map((c) => c.id)).size, chats.length);
const rt = new Runtime({
  cwd: path.join(state, "empty-workspace"),
  codexHome: legacyHome,
});
try {
  await rt.start();
  assert.equal(rt.authenticated, true);
  for (const c of chats) {
    // Runtime is exclusive after graceful production stop. Exact-ID resume only.
    const t = await rt.resume(c.id);
    assert.equal(t.id, c.id);
    if (c.startedAt) assert.ok((await rt.read(c.id)).thread.turns.length);
  }
  assert.deepEqual(
    await fs.readFile(path.join(state, "conversations.json")),
    original,
  );
  const manifest = {
    schema: 1,
    legacyHome: path.resolve(legacyHome),
    legacyThreadIds: chats.map((c) => c.id),
  };
  const handle = await fs.open(file, "wx", 0o600);
  try {
    await handle.writeFile(JSON.stringify(manifest, null, 2));
    await handle.sync();
  } finally {
    await handle.close();
  }
  console.log(
    JSON.stringify({
      legacyReadableAndResumable: chats.length,
      idsChanged: 0,
      historyMigrated: false,
    }),
  );
} finally {
  const exited = rt.child
    ? new Promise((r) => rt.child.once("exit", r))
    : Promise.resolve();
  rt.close();
  await exited;
}
