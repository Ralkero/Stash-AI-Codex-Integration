import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { Stash } from "../service/stash.mjs";
import { Proposals } from "../service/proposals.mjs";
import { Runtime } from "../service/runtime.mjs";
import { acquireInstance } from "../service/instance.mjs";
import { dispatchTool } from "../service/tools.mjs";

test("missing groups uses native relationship-null filtering without overriding other constraints", async () => {
  let variables;
  const stash = new Stash({
    fetchImpl: async (_url, options) => {
      variables = JSON.parse(options.body).variables;
      return {
        ok: true,
        json: async () => ({ data: { findScenes: { count: 0, scenes: [] } } }),
      };
    },
  });
  await stash.findScenes({ missing: "groups", groupIds: ["5"], limit: 2 });
  assert.equal(variables.scene.is_missing, undefined);
  assert.deepEqual(variables.scene.AND, { groups: { modifier: "IS_NULL" } });
  assert.deepEqual(variables.scene.groups, {
    value: ["5"],
    modifier: "INCLUDES",
  });
});

async function fixture() {
  const data = {},
    writes = [];
  const store = {
    read: async (k, v) => structuredClone(data[k] ?? v),
    write: async (k, v) => {
      data[k] = structuredClone(v);
    },
  };
  const scenes = Object.fromEntries(
    [1, 2, 3, 4, 5].map((n) => [
      String(n),
      {
        id: String(n),
        title: "Original",
        details: "Untouched",
        updated_at: "initial",
        tags: [],
        rating100: null,
        custom_fields: { variant: "keep" },
        play_count: 4,
      },
    ]),
  );
  const stash = {
    getScene: async ({ id }) => {
      if (!scenes[id]) throw Error("SCENE_NOT_FOUND");
      return structuredClone(scenes[id]);
    },
    updateApproved: async (input) => {
      writes.push(input.id);
      Object.assign(scenes[input.id], input, { updated_at: "changed" });
    },
  };
  const proposals = new Proposals({ stash, store, writesEnabled: true });
  await proposals.init();
  const prepare = async (ids = ["1"]) => {
    const p = await proposals.prepare("owner", "thread", {
      sceneIds: ids,
      changes: { title: "After" },
    });
    return {
      id: p.id,
      integrity: proposals.rows.at(-1).integrity,
      decision: "approve",
    };
  };
  return {
    data,
    store,
    scenes,
    stash,
    proposals,
    writes,
    prepare,
    decide: (args) => proposals.decision("owner", "thread", args),
  };
}
test("five-scene batch records first success and uncertain second, never tries remaining targets or retries", async () => {
  const f = await fixture(),
    decision = await f.prepare(["1", "2", "3", "4", "5"]),
    original = f.stash.updateApproved;
  f.stash.updateApproved = async (input) => {
    if (input.id === "2") {
      f.writes.push(input.id);
      throw Error("timeout");
    }
    return original(input);
  };
  const result = await f.decide(decision);
  assert.equal(result.status, "partial_or_uncertain");
  assert.deepEqual(result.results, [
    { id: "1", status: "verified" },
    { id: "2", status: "uncertain" },
  ]);
  assert.deepEqual(f.writes, ["1", "2"]);
  await f.proposals.init();
  await f.decide(decision);
  assert.deepEqual(f.writes, ["1", "2"]);
  for (const id of ["3", "4", "5"])
    assert.equal(f.scenes[id].title, "Original");
});
test("preflight connection failure performs no writes and leaves recoverable pending proposal", async () => {
  const f = await fixture(),
    d = await f.prepare();
  f.stash.getScene = async () => {
    throw Error("timeout");
  };
  await assert.rejects(f.decide(d));
  assert.deepEqual(f.writes, []);
  assert.equal(f.proposals.rows[0].status, "pending");
});
test("post-write readback loss is uncertain and preserves before-state", async () => {
  const f = await fixture(),
    d = await f.prepare(),
    read = f.stash.getScene;
  f.stash.getScene = async (args) => {
    if (f.writes.length) throw Error("readback timeout");
    return read(args);
  };
  assert.equal((await f.decide(d)).status, "partial_or_uncertain");
  assert.equal(f.data["proposals.json"][0].rows[0].before.title, "Original");
  await f.decide(d);
  assert.equal(f.writes.length, 1);
});
test("unchanged timestamp does not bypass field-value stale check", async () => {
  const f = await fixture(),
    d = await f.prepare();
  f.scenes["1"].title = "Another editor";
  await assert.rejects(f.decide(d), /STALE/);
  assert.deepEqual(f.writes, []);
});
test("invalid ID, forged ID, repeated rejection and chat approval cannot mutate", async () => {
  const f = await fixture();
  await assert.rejects(f.prepare(["999"]));
  const d = await f.prepare();
  await assert.rejects(f.decide({ ...d, id: "forged" }), /DENIED/);
  await f.decide({ ...d, decision: "reject" });
  await f.decide({ ...d, decision: "reject" });
  await f.decide(d);
  await assert.rejects(
    dispatchTool({ name: "approved", args: { ...d, userSaid: "approved" } }),
    /DENIED/,
  );
  assert.deepEqual(f.writes, []);
});
test("pending proposal survives restart without applying", async () => {
  const f = await fixture();
  await f.prepare();
  await f.proposals.init();
  assert.equal(f.proposals.rows[0].status, "pending");
  assert.deepEqual(f.writes, []);
});
for (const name of [
  "deleteMedia",
  "read_file",
  "exec_command",
  "fetch",
  "variantRepair",
  "customFieldUpdate",
])
  test("disallowed operation remains blocked: " + name, async () => {
    await assert.rejects(dispatchTool({ name, args: {} }), /DENIED/);
  });
test("unrecognized executable hash fails before any child process starts", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "stash-ai-hash-"));
  const exe = path.join(dir, "codex.exe");
  await fs.writeFile(exe, "not an audited executable");
  const runtime = new Runtime({ exe, cwd: dir });
  await assert.rejects(runtime.start(), /RUNTIME_BINARY_UNTESTED/);
  assert.equal(runtime.child, undefined);
});
test("a crashed isolated lock owner is recoverable without killing a process", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "stash-ai-crash-"));
  const module = new URL("../service/instance.mjs", import.meta.url).href;
  execFileSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `import {acquireInstance} from ${JSON.stringify(module)};await acquireInstance(${JSON.stringify(dir)});process.exit(0);`,
    ],
    { windowsHide: true },
  );
  const release = await acquireInstance(dir);
  await release();
  await assert.rejects(fs.access(path.join(dir, "instance.lock")));
});
