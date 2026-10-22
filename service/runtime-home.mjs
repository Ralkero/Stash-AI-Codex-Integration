import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

// initialize.codexHome is reported by the actual child, not inferred from env.
export async function verifyReportedHome(expected, reported) {
  const normalize = (value) => {
    if (typeof value !== "string" || !path.isAbsolute(value)) return null;
    const resolved = path.resolve(value);
    return process.platform === "win32" ? resolved.toLowerCase() : resolved;
  };
  if (!normalize(expected) || !normalize(reported))
    throw Error("CODEX_HOME_MISMATCH");
  // Windows MSIX may expose the same directory through a LocalAppData alias.
  // Compare canonical directories, not a permissive string-prefix match.
  const [a, b] = await Promise.all([
    fs.realpath(expected),
    fs.realpath(reported),
  ]).catch(() => {
    throw Error("CODEX_HOME_MISMATCH");
  });
  if (normalize(a) !== normalize(b)) throw Error("CODEX_HOME_MISMATCH");
}

// Never create a missing runtime home or silently fall back to the desktop.
// Setup/login is an explicit operator action, separate from normal startup.
export async function validateRuntimeHome(home, { isolated = false } = {}) {
  if (
    typeof home !== "string" ||
    !path.isAbsolute(home) ||
    path.resolve(home) === path.parse(home).root
  )
    throw Error("INVALID_CODEX_HOME");
  const resolved = path.resolve(home);
  for (let dir = resolved; ; dir = path.dirname(dir)) {
    const stat = await fs.lstat(dir).catch(() => {
      throw Error("CODEX_HOME_UNAVAILABLE");
    });
    if (!stat.isDirectory() || stat.isSymbolicLink())
      throw Error("INVALID_CODEX_HOME");
    if (path.dirname(dir) === dir) break;
  }
  if (isolated) {
    for (const name of ["config.toml", "AGENTS.md", "AGENTS.override.md"]) {
      const exists = await fs.lstat(path.join(resolved, name)).then(
        () => true,
        (e) => {
          if (e.code === "ENOENT") return false;
          throw Error("CODEX_HOME_UNAVAILABLE");
        },
      );
      if (exists) throw Error("UNEXPECTED_CODEX_CONFIGURATION");
    }
    // Existing descendants that can redirect credentials or persistence are denied.
    for (const name of [
      "auth.json",
      "sessions",
      "archived_sessions",
      "state_5.sqlite",
    ]) {
      const stat = await fs.lstat(path.join(resolved, name)).catch((e) => {
        if (e.code === "ENOENT") return null;
        throw Error("CODEX_HOME_UNAVAILABLE");
      });
      if (stat?.isSymbolicLink()) throw Error("INVALID_CODEX_HOME");
    }
  }
  if (!isolated) return resolved;
  const probe = path.join(resolved, ".stash-ai-write-check-" + randomUUID());
  let handle;
  try {
    handle = await fs.open(probe, "wx", 0o600);
  } catch {
    throw Error("CODEX_HOME_UNAVAILABLE");
  } finally {
    if (handle) {
      await handle.close();
      await fs.unlink(probe); // Only the exclusively created probe, never user data.
    }
  }
  return resolved;
}

export function runtimeEnvironment(parent, home) {
  const allowed = new Set([
    "path",
    "systemroot",
    "windir",
    "temp",
    "tmp",
    "localappdata",
    "appdata",
    "userprofile",
    "username",
    "userdomain",
    "comspec",
    "pathext",
    "programdata",
    "programfiles",
    "commonprogramfiles",
  ]);
  const env = Object.fromEntries(
    Object.entries(parent).filter(([k]) => allowed.has(k.toLowerCase())),
  );
  // Existing standalone probes may still explicitly inherit their test home.
  const selected =
    home ??
    Object.entries(parent).find(([k]) => k.toLowerCase() === "codex_home")?.[1];
  if (selected) env.CODEX_HOME = selected;
  return env;
}
