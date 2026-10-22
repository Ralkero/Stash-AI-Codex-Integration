// Opt-in experiment only. Does not change the installed companion, its index,
// global environment, desktop configuration, or any credential files.
import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { Store } from "../service/store.mjs";
import { Runtime } from "../service/runtime.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const candidate = path.join(
  process.env.LOCALAPPDATA,
  "StashAICommandCenter",
  "codex-home",
);
const mode = process.argv[2] || "inspect";
if (!["inspect", "fixture", "live", "worker"].includes(mode))
  throw Error("Unknown probe mode");

if (mode !== "worker") {
  // No reparse-point redirection of this experimental storage.
  for (let dir = candidate; ; dir = path.dirname(dir)) {
    const stat = await fs.lstat(dir).catch((e) => {
      if (e.code === "ENOENT") return null;
      throw e;
    });
    if (stat?.isSymbolicLink()) throw Error("REDIRECTED_HOME");
    if (path.dirname(dir) === dir) break;
  }
  const store = new Store(candidate);
  await store.init();
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) => !/^CODEX_HOME$|^CODEX_SQLITE_HOME$/i.test(key),
    ),
  );
  // Applies only to the experiment subprocess, not this process or Windows.
  env.CODEX_HOME = candidate;
  env.STASH_AI_TEST_HOME = candidate;
  const args =
    mode === "fixture"
      ? [path.join(root, "scripts/security-validation.mjs")]
      : mode === "live"
        ? [path.join(root, "scripts/live-runtime-validation.mjs"), "--isolated"]
        : [fileURLToPath(import.meta.url), "worker"];
  const child = spawn(process.execPath, args, {
    cwd: path.join(candidate, "empty-workspace"),
    env,
    windowsHide: true,
    stdio: ["ignore", "inherit", "inherit"],
  });
  process.exitCode = await new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("exit", (code) => resolve(code ?? 1));
  });
} else {
  const rt = new Runtime({ cwd: process.cwd() });
  try {
    const result = await rt.start(); // Retains both executable hash checks.
    const cfg = await rt.call("config/read", { includeLayers: false });
    const listed = await rt.call("thread/list", {
      limit: 100,
      useStateDbOnly: true,
      modelProviders: [],
    });
    console.log(
      JSON.stringify({
        ...result,
        subprocessHome: process.env.CODEX_HOME,
        credentialStore: cfg.config.cli_auth_credentials_store ?? "default",
        sqliteHome: cfg.config.sqlite_home ?? "CODEX_HOME default",
        personalMcpCount: Object.keys(cfg.config.mcp_servers || {}).length,
        localThreadCount: listed.data.length,
        threadIds: listed.data.map((t) => t.id),
        moreThreads: Boolean(listed.nextCursor),
      }),
    );
  } finally {
    const exited = rt.child
      ? new Promise((resolve) => rt.child.once("exit", resolve))
      : Promise.resolve();
    rt.close();
    await exited;
  }
}
