import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { VERSION } from "../service/main.mjs";
test("release versions agree across manifest, UI, toolbar, package and runtime client", async () => {
  const read = (name) =>
    fs.readFile(new URL("../" + name, import.meta.url), "utf8");
  assert.equal(JSON.parse(await read("package.json")).version, VERSION);
  assert.equal(JSON.parse(await read("package-lock.json")).version, VERSION);
  assert.equal(
    (await read("plugin/stash-ai-command-center.yml"))
      .match(/^version: (.+)$/m)[1]
      .trim(),
    VERSION,
  );
  for (const file of ["plugin/stash-ai.js", "plugin/toolbar.js"]) {
    const versions = [
      ...(await read(file)).matchAll(/version: "([0-9.]+)"/g),
    ].map((m) => m[1]);
    assert.ok(versions.length);
    assert.ok(
      versions.every((v) => v === VERSION),
      file,
    );
  }
  assert.ok(
    (await read("service/runtime.mjs")).includes(
      `clientInfo: { name: "stash_ai_command_center", version: "${VERSION}" }`,
    ),
  );
});
test("standalone security fixture always selects an isolated home instead of desktop defaults", async () => {
  const source = await fs.readFile(
    new URL("../scripts/security-validation.mjs", import.meta.url),
    "utf8",
  );
  assert.match(
    source,
    /mkdtemp\(path.join\(os.tmpdir\(\), "stash-ai-security-"\)\)/,
  );
  assert.match(source, /codexHome: fixtureHome/);
  assert.match(source, /isolatedHome: true/);
  assert.doesNotMatch(source, /: \{\}\)/);
});
