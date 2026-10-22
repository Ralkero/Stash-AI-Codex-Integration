import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
export class Store {
  constructor(dir) {
    this.dir = path.resolve(dir);
  }
  async init() {
    await fs.mkdir(this.dir, { recursive: true, mode: 0o700 });
    if (process.platform === "win32") {
      const user = execFileSync("whoami.exe", [], {
        encoding: "utf8",
        windowsHide: true,
      }).trim();
      execFileSync(
        "icacls.exe",
        [
          this.dir,
          "/inheritance:r",
          "/grant:r",
          `${user}:(OI)(CI)F`,
          "SYSTEM:(OI)(CI)F",
        ],
        { windowsHide: true, stdio: "ignore" },
      );
    }
    await fs.mkdir(path.join(this.dir, "empty-workspace"), {
      recursive: true,
      mode: 0o700,
    });
  }
  filename(name) {
    if (!/^[a-z0-9-]+\.json$/.test(name)) throw Error("INVALID_STORE_KEY");
    return path.join(this.dir, name);
  }
  async read(name, fallback) {
    try {
      return JSON.parse(await fs.readFile(this.filename(name), "utf8"));
    } catch (e) {
      if (e.code === "ENOENT") return structuredClone(fallback);
      throw Error("STATE_CORRUPT");
    }
  }
  async write(name, value) {
    const file = this.filename(name),
      tmp = file + "." + randomUUID() + ".tmp";
    const handle = await fs.open(tmp, "wx", 0o600);
    try {
      await handle.writeFile(JSON.stringify(value, null, 2));
      await handle.sync();
    } finally {
      await handle.close();
    }
    await fs.rename(tmp, file);
  }
}
