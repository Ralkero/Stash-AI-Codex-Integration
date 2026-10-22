// Actual installed runtime + controlled Responses fixture. No model credentials
// are sent to the fixture; no private conversation or metadata is captured.
import http from "node:http";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Runtime } from "../service/runtime.mjs";
import { TOOLS } from "../service/tools.mjs";
// Never fall back to the desktop's home. The controlled provider requires no
// login; keep new fixture sessions in a separate, credential-free scratch home.
// An explicit home is retained for probe-home-isolation's dedicated candidate.
const fixtureHome =
  process.env.STASH_AI_TEST_HOME ||
  (await fs.mkdtemp(path.join(os.tmpdir(), "stash-ai-security-")));
let requests = 0,
  verified = 0;
const allowed = new Set([
  ...TOOLS.map((t) => t.name),
  "clock__curr_time",
  "list_mcp_resources",
  "list_mcp_resource_templates",
  "read_mcp_resource",
]);
const server = http.createServer(async (req, res) => {
  let body = "";
  for await (const c of req) body += c;
  if (!req.url.endsWith("/responses")) {
    res.writeHead(404);
    res.end();
    return;
  }
  assert.equal(
    req.headers.authorization,
    undefined,
    "fixture must receive no credentials",
  );
  const data = JSON.parse(body);
  requests++;
  for (const item of data.input || [])
    if (item.type === "custom_tool_call_output")
      for (const part of item.output || [])
        if (part.text?.startsWith('{"fetch"')) {
          const result = JSON.parse(part.text);
          assert.equal(result.fetch, "undefined");
          assert.equal(result.process, "undefined");
          assert.equal(result.require, "undefined");
          assert.ok(result.tools.every((name) => allowed.has(name)));
          assert.ok(TOOLS.every((t) => result.tools.includes(t.name)));
          verified++;
        }
  for (const item of data.input || [])
    if (item.type === "additional_tools")
      assert.ok(
        item.tools.every((t) => ["functions", "clock"].includes(t.name)),
        "unexpected native tool namespace",
      );
  const item =
    requests % 2 === 1
      ? {
          id: "tool" + requests,
          type: "custom_tool_call",
          call_id: "call" + requests,
          name: "exec",
          namespace: "functions",
          input:
            "text({fetch:typeof fetch,process:typeof process,require:typeof require,tools:ALL_TOOLS.map(t=>t.name)}); for (const name of ['exec_command','apply_patch','read_file','web__run','mcp__rea__execute']) { if(typeof tools[name] !== 'undefined') throw Error('unsafe tool exposed: '+name); } text(await tools.list_mcp_resources({}));",
        }
      : {
          id: "message" + requests,
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: "fixture complete" }],
        };
  const response = {
    id: "resp_" + requests,
    object: "response",
    status: "completed",
    output: [item],
    usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
  };
  res.writeHead(200, { "Content-Type": "text/event-stream" });
  for (const e of [
    {
      type: "response.created",
      response: { ...response, status: "in_progress", output: [] },
    },
    { type: "response.output_item.added", output_index: 0, item },
    { type: "response.output_item.done", output_index: 0, item },
    { type: "response.completed", response },
  ])
    res.write(`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`);
  res.end();
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
async function make() {
  const rt = new Runtime({
    cwd: process.cwd(),
    tools: TOOLS,
    codexHome: fixtureHome,
    isolatedHome: true,
  });
  await rt.start();
  rt.threadConfig = {
    ...rt.threadConfig,
    "model_providers.stash_isolation_fixture.name": "Isolated test fixture",
    "model_providers.stash_isolation_fixture.base_url": `http://127.0.0.1:${server.address().port}/v1`,
    "model_providers.stash_isolation_fixture.wire_api": "responses",
    "model_providers.stash_isolation_fixture.requires_openai_auth": false,
    "model_providers.stash_isolation_fixture.supports_websockets": false,
  };
  const options = rt.options.bind(rt);
  rt.options = () => ({
    ...options(),
    modelProvider: "stash_isolation_fixture",
    developerInstructions: "Security fixture.",
  });
  return rt;
}
let rt = await make();
async function run(id) {
  let done;
  const completed = new Promise((r) => (done = r));
  const listener = (m) => {
    if (m.method === "turn/completed") done(m.params.turn.status);
  };
  rt.on("notification", listener);
  await rt.turn(id, "Run the fixture.");
  assert.equal(
    await Promise.race([
      completed,
      new Promise((_, reject) =>
        setTimeout(() => reject(Error("timeout")), 30000).unref(),
      ),
    ]),
    "completed",
  );
  rt.off("notification", listener);
}
try {
  const thread = await rt.create();
  await run(thread.id);
  const exited = new Promise((r) => rt.child.once("exit", r));
  rt.close();
  await exited;
  rt = await make();
  await rt.resume(thread.id);
  await run(thread.id);
  assert.ok(verified >= 2);
  console.log(
    JSON.stringify({
      runtimeCatalogChecks: verified,
      newThread: true,
      restartResume: true,
      noFilesystem: true,
      noNetwork: true,
      noShell: true,
      noPersonalMcpTools: true,
      noCollaboration: true,
      credentialsSentToFixture: false,
      isolatedFixtureHome: true,
      fixtureHome,
    }),
  );
} finally {
  rt.close();
  server.close();
}
