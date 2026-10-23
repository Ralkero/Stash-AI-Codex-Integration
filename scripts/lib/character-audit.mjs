// Offline read-only audit helpers. No credentials, mutations or private bindings.
import { fingerprint, ids, reconcileAll } from "./identity-reconciliation.mjs";
export { fingerprint, ids, reconcileAll };
export async function inventory(fetchPage, pageSize = 200) {
  const rows = [],
    seen = new Set();
  let expected = null,
    pages = 0;
  for (let page = 1; ; page++) {
    const result = await fetchPage(page, pageSize);
    pages++;
    if (
      !Number.isInteger(result.count) ||
      result.count < 0 ||
      !Array.isArray(result.rows)
    )
      throw Error("INVALID_PAGE");
    if (expected !== null && expected !== result.count)
      throw Error("COUNT_DRIFT");
    expected = result.count;
    if (result.rows.length > pageSize) throw Error("PAGE_LIMIT");
    for (const row of result.rows) {
      if (!/^[1-9]\d*$/.test(row.id) || seen.has(row.id))
        throw Error("DUPLICATE_OR_INVALID_ID");
      seen.add(row.id);
      rows.push(row);
    }
    if (rows.length === expected) break;
    if (!result.rows.length || rows.length > expected)
      throw Error("INCOMPLETE_INVENTORY");
  }
  return { rows, pages, count: expected };
}
export function comparePasses(first, second) {
  const a = new Map(first.map((r) => [r.id, r])),
    b = new Map(second.map((r) => [r.id, r]));
  if (a.size !== first.length || b.size !== second.length)
    throw Error("DUPLICATE_ID");
  return ids([...new Set([...a.keys(), ...b.keys()])]).filter(
    (id) => fingerprint(a.get(id) || null) !== fingerprint(b.get(id) || null),
  );
}
export function coverage(scenes, tags, relations) {
  const sceneIds = new Set(scenes.map((s) => s.id)),
    tagIds = new Set(tags.map((t) => t.id));
  if (sceneIds.size !== scenes.length || tagIds.size !== tags.length)
    throw Error("DUPLICATE_INVENTORY_ID");
  const pairs = new Set(),
    assigned = new Set();
  for (const scene of scenes)
    for (const tag of scene.tags) {
      if (!tagIds.has(tag.id)) throw Error("DANGLING_TAG");
      const pair = scene.id + ":" + tag.id;
      if (pairs.has(pair)) throw Error("DUPLICATE_RELATIONSHIP");
      pairs.add(pair);
      assigned.add(tag.id);
    }
  if (relations) {
    const sql = new Set(
      relations.map((r) => String(r.scene_id) + ":" + String(r.tag_id)),
    );
    if (
      sql.size !== relations.length ||
      sql.size !== pairs.size ||
      [...sql].some((p) => !pairs.has(p))
    )
      throw Error("RELATIONSHIP_MISMATCH");
  }
  return {
    scenes: scenes.length,
    tagDefinitions: tags.length,
    assignedTagDefinitions: assigned.size,
    relationships: pairs.size,
    untaggedScenes: scenes.filter((s) => !s.tags.length).length,
  };
}
export function historicalCompatible(old, current) {
  if (!old || !current || old.id !== current.id) return false;
  // Cleanup changes tags and timestamps. All independent association evidence
  // must still match; an old destination claim is never itself new evidence.
  const project = (s) =>
    Object.fromEntries(
      ["title", "details", "studio", "groups", "files"].map((k) => [
        k,
        s[k] ?? null,
      ]),
    );
  return fingerprint(project(old)) === fingerprint(project(current));
}
export const escapeHtml = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
// RFC4180 quoting plus spreadsheet formula-injection protection. JSON retains
// exact raw text; CSV explicitly prefixes dangerous leading characters.
export const csvCell = (value) => {
  const text = String(value ?? "");
  return (
    '"' +
    (/^[=+@\-\t\r]/.test(text) ? "'" : "") +
    text.replaceAll('"', '""') +
    '"'
  );
};
export function noCompletedRemovals(entries, completed) {
  const pairs = new Set(
    completed.flatMap((e) => e.remove.map((t) => e.sceneId + ":" + t)),
  );
  for (const e of entries)
    for (const t of e.stageA.remove)
      if (pairs.has(e.sceneId + ":" + t))
        throw Error("COMPLETED_REMOVAL_REPROPOSED");
  return true;
}
