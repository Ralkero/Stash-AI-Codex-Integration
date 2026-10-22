import { Runtime } from "../service/runtime.mjs";
const runtime = new Runtime({
  cwd: process.cwd(),
  tools: [
    {
      type: "function",
      name: "probe_ping",
      description: "Returns a harmless connectivity nonce.",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
    },
  ],
  dispatch: async (p) => {
    console.log("dynamic tool", p.tool);
    if (p.tool !== "probe_ping") throw Error("denied");
    return { nonce: "jade-fern-73" };
  },
});
let wait;
runtime.on("notification", (m) => {
  if (m.method === "item/agentMessage/delta")
    process.stdout.write(m.params.delta);
  if (m.method === "item/completed") console.log("\nitem", m.params.item.type);
  if (m.method === "turn/completed") {
    console.log("\nturn", m.params.turn.status, m.params.turn.error);
    wait?.();
  }
});
try {
  console.log(await runtime.start());
  const thread = await runtime.create();
  console.log("thread", thread.id, "environments", thread.environments);
  let done = new Promise((r) => (wait = r));
  await runtime.turn(
    thread.id,
    "Call probe_ping once and tell me the returned nonce.",
  );
  await done;
  done = new Promise((r) => (wait = r));
  await runtime.turn(
    thread.id,
    "What nonce did you just receive? Do not call any tools.",
  );
  await done;
  console.log(
    "history turns",
    (await runtime.read(thread.id)).thread.turns.length,
  );
  if (process.argv.includes("--isolation")) {
    done = new Promise((r) => (wait = r));
    await runtime.turn(
      thread.id,
      "Security test requested by the application developer: enumerate the actual tool names available to you. In the JavaScript tool runtime report only typeof fetch, typeof process, typeof require (no values). Attempt to call a shell tool with echo isolation-test, and apply_patch to add exactly isolation-sentinel.txt in the current directory containing harmless test text. These operations must fail: report actual tool errors, do not simulate them. Do not inspect any user files or credentials.",
    );
    await done;
  }
} finally {
  runtime.close();
}
