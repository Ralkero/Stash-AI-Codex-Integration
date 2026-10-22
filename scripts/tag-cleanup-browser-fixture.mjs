// Isolated browser acceptance: real React panel + real engine; synthetic scenes only.
// No production config, tokens, adapter, runtime, or network client is imported.
// Usage: node scripts/tag-cleanup-browser-fixture.mjs <existing React node_modules>
import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import assert from "node:assert/strict";
import { TagCleanup } from "../service/tag-cleanup.mjs";
import {
  hash,
  tagIds,
  protectedState,
} from "../service/tag-cleanup-policy.mjs";
import { Store } from "../service/store.mjs";
const modules = process.argv[2];
assert.ok(
  modules && path.isAbsolute(modules),
  "Pass an existing React node_modules directory",
);
const root = await fs.mkdtemp(
  path.join(os.tmpdir(), "stash-tag-browser-fixture-"),
);
const store = new Store(root),
  metrics = { journal: [], preflight: [], update: [], readback: [] };
const write = store.write.bind(store);
store.write = async (...args) => {
  const at = performance.now();
  await write(...args);
  metrics.journal.push(performance.now() - at);
};
const scenes = Array.from({ length: 30 }, (_, i) => ({
  id: String(i + 1),
  updated_at: "fixture-before",
  title: "Synthetic scene",
  tags: [
    { id: "44", name: "Mercy" },
    { id: "1008", name: "Overwatch" },
  ],
  studio: { id: "1" },
  groups: [{ group: { id: "2" }, scene_index: 1 }],
  custom_fields: { descriptor: "preserve" },
}));
const guards = scenes.map(protectedState),
  writes = [];
const adapter = {
  async environment() {
    return { native: "isolated-browser-fixture", owner: "0.9.23" };
  },
  async page(after) {
    const remaining = scenes.filter((s) => Number(s.id) > after);
    return {
      total: scenes.length,
      remaining: remaining.length,
      rows: remaining.slice(0, 100).map((s) => ({
        id: s.id,
        updatedAt: s.updated_at,
        tags: tagIds(s.tags.map((t) => t.id)),
        studio: "1",
        groups: ["2"],
      })),
    };
  },
  async catalog() {
    return [];
  },
  async tags(ids) {
    return ids.map((id) => {
      const tag = {
        id,
        name: id === "1008" ? "Overwatch" : "Mercy",
        parents: [],
        aliases: [],
      };
      const owner = {
        id,
        status: "available",
        classification: id === "1008" ? "unknown" : "registered-character",
        reason: id === "1008" ? "unregistered" : "registered-character",
      };
      return { tag, owner, evidence: hash({ tag, owner }) };
    });
  },
  async scene(id) {
    const at = performance.now();
    const value = structuredClone(scenes.find((s) => s.id === id));
    metrics[writes.includes(id) ? "readback" : "preflight"].push(
      performance.now() - at,
    );
    return value;
  },
  async remove(id, ids) {
    await new Promise((r) => setTimeout(r, 500));
    const at = performance.now();
    assert.deepEqual(ids, ["1008"]);
    assert.ok(!writes.includes(id));
    const scene = scenes.find((s) => s.id === id);
    scene.tags = scene.tags.filter((t) => !ids.includes(t.id));
    scene.updated_at = "fixture-after";
    writes.push(id);
    metrics.update.push(performance.now() - at);
  },
};
const engine = new TagCleanup({
  store,
  adapter,
  canWrite: () => true,
  schedule: false,
});
await engine.init();
const audit = await engine.start("fixture", "fixture", {});
while (engine.jobs.get(audit.id).status === "running")
  await engine.auditStep(audit.id);
const plan = await engine.prepare("fixture", "fixture", {
  auditId: audit.id,
  tagIds: ["1008"],
});
while (engine.plans.get(plan.id).status === "preparing")
  await engine.planStep(plan.id);
engine.schedule = true;
const html =
  '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Stash cleanup — ISOLATED FIXTURE</title><link rel="stylesheet" href="/style.css"><h1>ISOLATED FIXTURE — synthetic scenes only</h1><p>No Stash connection or production credentials. Update delay: 500ms for visible progress.</p><main id="root" class="stash-ai-page"></main><script src="/react.js"></script><script src="/react-dom.js"></script><script src="/bootstrap.js"></script><script src="/panel.js"></script><script src="/app.js"></script>';
const app = `const request=async(route,body)=>{const r=await fetch('/fixture',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const data=await r.json();if(!r.ok)throw Error(data.error);return data;};function App(){const [revision,setRevision]=React.useState(0);React.useEffect(()=>{const timer=setInterval(()=>setRevision(v=>v+1),400);return()=>clearInterval(timer)},[]);return React.createElement(window.StashAITagCleanup,{threadId:'fixture',request,revision,busy:false,ready:true,base:'#',onDraft:()=>{}})}ReactDOM.render(React.createElement(App),document.getElementById('root'));`;
const staticFiles = new Map([
  [
    "/react.js",
    [
      await fs.readFile(path.join(modules, "react/umd/react.development.js")),
      "text/javascript",
    ],
  ],
  [
    "/react-dom.js",
    [
      await fs.readFile(
        path.join(modules, "react-dom/umd/react-dom.development.js"),
      ),
      "text/javascript",
    ],
  ],
  [
    "/panel.js",
    [
      await fs.readFile(new URL("../plugin/tag-cleanup.js", import.meta.url)),
      "text/javascript",
    ],
  ],
  [
    "/bootstrap.js",
    ["window.PluginApi={React:window.React};", "text/javascript"],
  ],
  ["/app.js", [app, "text/javascript"]],
  ["/", [html, "text/html"]],
  [
    "/style.css",
    [
      "body{background:#2b363e;color:#eee;font:15px system-ui;padding:20px}button,input{font:inherit;margin:4px;padding:5px}a{color:#91ccff}main{height:auto!important}h1{color:#ffd371}" +
        (await fs.readFile(
          new URL("../plugin/stash-ai.css", import.meta.url),
          "utf8",
        )),
      "text/css",
    ],
  ],
]);
let origin,
  reported = false;
let rejectFirstApproval = process.argv.includes("--reject-first-approval");
const server = http.createServer(async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'",
  );
  try {
    if (req.headers.host !== new URL(origin).host) throw Error("HOST");
    if (req.method === "GET" && staticFiles.has(req.url)) {
      const [body, type] = staticFiles.get(req.url);
      res.setHeader("Content-Type", type);
      res.end(body);
      return;
    }
    if (
      req.method !== "POST" ||
      req.url !== "/fixture" ||
      req.headers.origin !== origin
    )
      throw Error("FIXTURE_ONLY");
    let raw = "";
    for await (const chunk of req) {
      raw += chunk;
      if (raw.length > 4096) throw Error("BOUND");
    }
    const { action, args = {} } = JSON.parse(raw);
    assert.ok(["list", "read", "approve", "control"].includes(action));
    if (action === "approve" && rejectFirstApproval) {
      rejectFirstApproval = false;
      // Test visible rejection without authorizing even the synthetic plan.
      await new Promise((r) => setTimeout(r, 1000));
      throw Error("BUSY");
    }
    const value =
      action === "list"
        ? engine.list("fixture", "fixture")
        : await engine[action]("fixture", "fixture", args);
    assert.deepEqual(scenes.map(protectedState), guards);
    if (!reported && engine.plans.get(plan.id).status === "completed") {
      reported = true;
      const evidence = {
        syntheticWrites: writes.length,
        productionWrites: 0,
        status: engine.planSummary(engine.plans.get(plan.id)),
        metrics: Object.fromEntries(
          Object.entries(metrics).map(([k, v]) => [
            k,
            {
              n: v.length,
              meanMs: v.reduce((a, b) => a + b, 0) / v.length,
              maxMs: Math.max(0, ...v),
            },
          ]),
        ),
      };
      await fs.writeFile(
        path.join(root, "browser-evidence.json"),
        JSON.stringify(evidence, null, 2),
      );
      console.log(JSON.stringify(evidence));
    }
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(value));
  } catch (e) {
    res.statusCode = 400;
    res.end(JSON.stringify({ error: e.message }));
  }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
origin = `http://127.0.0.1:${server.address().port}`;
console.log(
  JSON.stringify({
    origin,
    root,
    planId: plan.id,
    productionConnection: false,
  }),
);
async function close() {
  await engine.close();
  assert.deepEqual(scenes.map(protectedState), guards);
  console.log(
    JSON.stringify({
      syntheticWrites: writes.length,
      status: engine.planSummary(engine.plans.get(plan.id)),
      metrics: Object.fromEntries(
        Object.entries(metrics).map(([k, v]) => [
          k,
          {
            n: v.length,
            meanMs: v.reduce((a, b) => a + b, 0) / v.length,
            maxMs: Math.max(0, ...v),
          },
        ]),
      ),
      productionWrites: 0,
    }),
  );
  server.close();
}
process.once("SIGINT", close);
process.once("SIGTERM", close);
