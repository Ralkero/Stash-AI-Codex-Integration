import fs from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
for (const dir of ["service", "plugin", "scripts", "tests"])
  for (const name of await fs.readdir(path.join(root, dir)))
    if (/\.(mjs|js)$/.test(name))
      execFileSync(process.execPath, ["--check", path.join(root, dir, name)], {
        stdio: "inherit",
      });
console.log("All JavaScript modules parse. No dependency build required.");
