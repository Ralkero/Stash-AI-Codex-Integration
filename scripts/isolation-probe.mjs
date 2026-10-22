// Controlled model fixture: inspect the actual runtime catalog and force denied
// calls without asking a language model to obey adversarial test instructions.
import http from "node:http";
import { Runtime } from "../service/runtime.mjs";
let requests = 0;
const server = http.createServer(async (req, res) => {
  let body = "";
  for await (const c of req) body += c;
  if (!req.url.endsWith("/responses")) {
    res.writeHead(404);
    res.end();
    return;
  }
  const data = JSON.parse(body);
  requests++;
  console.log(
    "catalog",
    JSON.stringify(
      data.tools?.map((t) => ({
        type: t.type,
        name: t.name,
        tools: t.tools?.map((x) => x.name),
      })),
    ),
  );
  console.log(
    "input types",
    data.input?.map((x) => x.type),
  );
  for (const item of data.input || [])
    if (item.type === "additional_tools")
      console.log(
        "additional tools",
        JSON.stringify(
          item.tools.map((t) => ({
            name: t.name,
            tools: t.tools?.map((x) => x.name),
          })),
        ),
      );
  for (const item of data.input || [])
    if (item.type.endsWith("_call_output"))
      console.log("tool output", item.output);
  const response = {
    id: "resp_fixture_" + requests,
    object: "response",
    status: "completed",
    output: [],
    usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
  };
  const item =
    requests === 1
      ? {
          id: "tool1",
          type: "custom_tool_call",
          call_id: "call1",
          name: "exec",
          namespace: "functions",
          input:
            "text({fetch:typeof fetch,process:typeof process,require:typeof require,tools:ALL_TOOLS.map(t=>t.name)}); try { text(await tools.apply_patch('*** Begin Patch\\n*** Add File: isolation-sentinel.txt\\n+test\\n*** End Patch')); } catch(e) { text(String(e)); } text(await tools.list_mcp_resources({}));",
        }
      : {
          id: "message1",
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: "fixture complete" }],
        };
  response.output = [item];
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
const rt = new Runtime({ cwd: process.cwd() });
try {
  await rt.start();
  rt.threadConfig = {
    ...rt.threadConfig,
    "model_providers.stash_isolation_fixture.name": "Isolated test fixture",
    "model_providers.stash_isolation_fixture.base_url": `http://127.0.0.1:${server.address().port}/v1`,
    "model_providers.stash_isolation_fixture.wire_api": "responses",
    "model_providers.stash_isolation_fixture.requires_openai_auth": false,
    "model_providers.stash_isolation_fixture.supports_websockets": false,
  };
  const old = rt.options.bind(rt);
  rt.options = () => ({
    ...old(),
    modelProvider: "stash_isolation_fixture",
    developerInstructions: "Security fixture. Use only fixture instructions.",
  });
  const t = await rt.create();
  let done;
  const completed = new Promise((r) => (done = r));
  rt.on("notification", (m) => {
    if (m.method === "turn/completed") {
      console.log("completed", m.params.turn.status);
      done();
    }
    if (m.method === "error") console.log("runtime error", m.params);
  });
  await rt.turn(t.id, "Run the fixture.");
  await Promise.race([
    completed,
    new Promise((_, reject) =>
      setTimeout(() => reject(Error("timeout")), 45000).unref(),
    ),
  ]);
} finally {
  rt.close();
  server.close();
}
