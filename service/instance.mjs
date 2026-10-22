import fs from "node:fs/promises";
import path from "node:path";
// Prevent two entrypoints sharing approval/audit state. Never kill a stale PID.
export async function acquireInstance(dir) {
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  const file = path.join(dir, "instance.lock");
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const handle = await fs.open(file, "wx", 0o600);
      await handle.writeFile(String(process.pid));
      await handle.close();
      return async () => {
        try {
          if ((await fs.readFile(file, "utf8")) === String(process.pid))
            await fs.unlink(file);
        } catch {}
      };
    } catch (e) {
      if (e.code !== "EEXIST") throw e;
      const pid = Number(await fs.readFile(file, "utf8"));
      if (!Number.isInteger(pid) || pid < 1)
        throw Error("INSTANCE_LOCK_INVALID");
      let alive = true;
      try {
        process.kill(pid, 0);
      } catch (e) {
        if (e.code === "ESRCH") alive = false;
      }
      if (alive) throw Error("INSTANCE_ALREADY_RUNNING");
      await fs.unlink(file);
    }
  }
  throw Error("INSTANCE_LOCK_FAILED");
}
