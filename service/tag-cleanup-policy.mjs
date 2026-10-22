// This installation's explicit user policy; classification is not approval.
import { createHash, createHmac } from "node:crypto";
import { check, id } from "./validation.mjs";
export const LIMITS = Object.freeze({
  scenes: 10000,
  tags: 2000,
  associations: 200000,
  page: 100,
  tagPage: 50,
  jobs: 32,
  plans: 64,
  bytes: 32 * 1024 * 1024,
  batch: 5,
  ttl: 24 * 60 * 60 * 1000,
  duration: 60 * 60 * 1000,
});
export const POLICY = 1;
// Exact installation identities with audited scene-writer recurrence prevention.
// Membership alone is NOT a classification decision or execution approval.
export const RECURRENCE_PROTECTED_TAGS = Object.freeze({
  956: "Stellar Blade",
  957: "Resident Evil",
  989: "Street Fighter",
  1008: "Overwatch",
  1029: "League of Legends",
  1066: "Elden Ring",
  1080: "Dead or Alive",
});
export const canonical = (value) => JSON.stringify(sortObject(value));
function sortObject(v) {
  if (Array.isArray(v)) return v.map(sortObject);
  if (v && typeof v === "object")
    return Object.fromEntries(
      Object.keys(v)
        .sort()
        .map((k) => [k, sortObject(v[k])]),
    );
  return v;
}
export const hash = (value) =>
  createHash("sha256").update(canonical(value)).digest("hex");
export const seal = (key, value) =>
  createHmac("sha256", key).update(canonical(value)).digest("hex");
export const same = (a, b) => canonical(a) === canonical(b);
export function tagIds(values) {
  check(Array.isArray(values) && values.length <= 100, "TAG_LIMIT");
  const result = values.map(id).sort((a, b) => Number(a) - Number(b));
  check(new Set(result).size === result.length, "DUPLICATE_TAG");
  return result;
}
export const normalize = (value) =>
  String(value).normalize("NFKC").trim().toLowerCase();
export function protectedState(scene) {
  const s = structuredClone(scene);
  delete s.tags;
  delete s.updated_at;
  for (const k of ["performers", "galleries"])
    if (s[k]) s[k].sort((a, b) => Number(a.id) - Number(b.id));
  if (s.groups)
    s.groups.sort((a, b) => Number(a.group.id) - Number(b.group.id));
  return hash(s);
}
export function classifyTag(tag, owner, decision = null) {
  const names = [tag.name, ...(tag.aliases || [])].map(normalize);
  const dependency = names.find((n) =>
    [
      "needs review",
      "variant hidden",
      "characters",
      "character",
      "descriptors",
    ].includes(n),
  );
  if (dependency)
    return {
      category: "system-dependent",
      reason: `Workflow/category tag: ${dependency}. Dependency must be resolved before removal.`,
      eligible: false,
    };
  if (!owner || owner.status !== "available")
    return {
      category: "insufficient-evidence",
      reason: "Character owner evidence unavailable.",
      eligible: false,
    };
  const positive = ["character-parent", "registered-character"].includes(
    owner.classification,
  );
  const conflicts = [
    "conflicting-parents",
    "conflicting-rules",
    "invalid-reference",
  ].includes(owner.reason);
  if (positive)
    return {
      category: "confirmed-character",
      reason: "Recognized by the Character owner; protected from cleanup.",
      eligible: false,
    };
  if (conflicts)
    return {
      category: "ambiguous",
      reason: `Owner reports ${owner.reason}; review the conflict before any removal.`,
      eligible: false,
    };
  if (decision?.choice === "character")
    return {
      category: "confirmed-character",
      reason: "Explicit user decision: keep this exact Tag identity.",
      eligible: false,
    };
  if (decision?.choice === "non-character")
    return {
      category: "confirmed-non-character",
      reason:
        RECURRENCE_PROTECTED_TAGS[tag.id] === tag.name
          ? "Explicit user non-Character decision. The audited Auto-Tagger prevents new scene assignments of this exact identity. This is not cleanup approval."
          : "Explicit user decision for this exact Tag identity (not cleanup approval). Recurrence prevention is not established; excluded from cleanup.",
      eligible: RECURRENCE_PROTECTED_TAGS[tag.id] === tag.name,
    };
  // Exact identity AND name bound to the user's v0.11 request. Not a name heuristic.
  if (tag.id === "1008" && tag.name === "Overwatch")
    return {
      category: "confirmed-non-character",
      reason:
        "User explicitly identified Overwatch Tag 1008 as a misplaced Franchise assignment. The audited Auto-Tagger blocks new scene assignments of this ID.",
      eligible: true,
    };
  if (owner.classification === "owner-excluded")
    return {
      category: "confirmed-non-character",
      reason:
        "Owner explicitly excludes this identity from Characters. Recurrence prevention is not established for this identity; blocked pending investigation.",
      eligible: false,
    };
  if (tag.matches?.length)
    return {
      category: "probable-non-character",
      reason:
        "Name matches a native Franchise/Author. Name equality is not proof: a Character homonym is possible.",
      eligible: false,
    };
  return {
    category: "ambiguous",
    reason: `Owner classification: ${owner.reason || "unknown"}. Unknown does not mean non-character.`,
    eligible: false,
  };
}
