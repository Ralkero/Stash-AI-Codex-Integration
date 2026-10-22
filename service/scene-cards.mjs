import { check, id } from "./validation.mjs";
import { sceneReasons, findingReasons } from "./scene-reasons.mjs";
import { characterExplanation } from "./character-explanations.mjs";
import { sceneEvidence } from "./recommendation-policy.mjs";

// Image paths belong exclusively to the UI data route, never model tool results.
export function screenshotPath(value, sceneId, stashUrl) {
  if (typeof value !== "string") return null;
  try {
    const base = new URL(stashUrl),
      u = new URL(value, base);
    if (
      u.origin !== base.origin ||
      u.username ||
      u.password ||
      u.hash ||
      u.pathname !== `/scene/${sceneId}/screenshot`
    )
      return null;
    // Reuse browser's same-origin Stash authentication. No API keys in DOM/sidecar.
    const stamp = u.searchParams.get("t");
    return (
      u.pathname + (stamp && /^[\d.-]{1,40}$/.test(stamp) ? "?t=" + stamp : "")
    );
  } catch {
    return null;
  }
}
const label = (value) => (typeof value === "string" ? value.slice(0, 500) : "");
const named = (value) => ({ id: id(value.id), name: label(value.name) });

export async function hydrateScenes(stash, adapters, collection) {
  const sceneIds = collection.scenes.map((s) => id(s.sceneId));
  check(sceneIds.length > 0 && sceneIds.length <= 20);
  const observedAt = new Date().toISOString();
  const unavailable = (sceneId, status) => {
    const row = collection.scenes.find((s) => s.sceneId === sceneId);
    const findings = row.findings.map((code) => ({
      code,
      current: "unverified",
    }));
    return {
      sceneId,
      status,
      findings,
      reasons: sceneReasons(collection, row, findings),
      findingExplanations: findingReasons(collection, row, findings),
    };
  };
  const fields =
    "id title updated_at studio{id name} groups{group{id name} scene_index} tags{id name} paths{screenshot} files{width height duration}";
  let native;
  try {
    native = await stash.query(
      `query(${sceneIds.map((_, i) => `$id${i}:ID!`).join(",")}){${sceneIds.map((_, i) => `s${i}:findScene(id:$id${i}){${fields}}`).join(" ")}}`,
      Object.fromEntries(sceneIds.map((v, i) => ["id" + i, v])),
    );
  } catch {
    return {
      observedAt,
      atomic: false,
      scenes: sceneIds.map((sceneId) => unavailable(sceneId, "unavailable")),
    };
  }
  const safeRead = (key) =>
    adapters.read(key, { sceneIds }).catch(() => ({ status: "unavailable" }));
  const [characters, descriptors] = await Promise.all([
    safeRead("characters"),
    safeRead("descriptors"),
  ]);
  return {
    observedAt,
    atomic: false,
    scenes: sceneIds.map((sceneId, i) => {
      const s = native["s" + i];
      const row = collection.scenes.find((row) => row.sceneId === sceneId);
      const historic = row.findings;
      if (!s) return unavailable(sceneId, "not_found");
      check(
        s.id === sceneId && Array.isArray(s.tags) && Array.isArray(s.groups),
        "SCENE_RESULT_INVALID",
      );
      const identity =
        characters.status === "available" &&
        characters.scenes.find((row) => row.sceneId === sceneId);
      const trusted =
        identity?.status === "available" &&
        identity.updatedAt === s.updated_at &&
        identity.assignedTagCount === s.tags.length &&
        identity.characterTagIds.every((v) => s.tags.some((t) => t.id === v)) &&
        (identity.unclassifiedTags || []).every((t) =>
          s.tags.some((n) => n.id === t.id && n.name.slice(0, 120) === t.name),
        )
          ? identity
          : null;
      const review =
        descriptors.status === "available" &&
        descriptors.scenes.find((row) => row.sceneId === sceneId);
      const trustedReview =
        review &&
        review.status !== "not_found" &&
        review.updatedAt === s.updated_at
          ? review
          : null;
      const presence = !s.tags.length
        ? "absent"
        : trusted?.presence || "unknown";
      const conditions = {
        "missing-author": s.groups.length === 0,
        "missing-franchise": !s.studio,
        "missing-characters":
          presence === "unknown" ? null : presence === "absent",
        "descriptor-review": trustedReview?.needsDescriptorReview ?? null,
        "needs-review": trustedReview?.autoTaggerNeedsReview ?? null,
        "character-unknown": !s.tags.length
          ? false
          : trusted
            ? presence === "unknown"
            : null,
      };
      const findings = historic.map((code) => ({
        code,
        current:
          conditions[code] == null
            ? "unverified"
            : conditions[code]
              ? "still-present"
              : "no-longer-present",
      }));
      const characterState = {
        presence,
        completeness:
          trusted?.completeness || (!s.tags.length ? "complete" : "unknown"),
        names: trusted
          ? s.tags
              .filter((t) => trusted.characterTagIds.includes(t.id))
              .map(named)
          : [],
        unclassifiedCount:
          trusted?.unclassifiedCount ?? (s.tags.length === 0 ? 0 : null),
        ...(trusted?.detailSchema === 1
          ? {
              detailSchema: 1,
              unclassifiedTags: trusted.unclassifiedTags,
              unclassifiedDetailsTruncated:
                trusted.unclassifiedDetailsTruncated,
            }
          : {}),
      };
      characterState.explanation = characterExplanation(characterState);
      return {
        sceneId,
        status: "available",
        reviewEvidence: sceneEvidence(s, trusted, trustedReview, {
          characters: characters.ownerVersion,
          descriptors: descriptors.ownerVersion,
        }),
        title: label(s.title),
        screenshot: screenshotPath(s.paths?.screenshot, sceneId, stash.url),
        franchise: s.studio ? named(s.studio) : null,
        authors: s.groups.slice(0, 100).map((g) => named(g.group)),
        authorsTruncated: s.groups.length > 100,
        characters: characterState,
        descriptors: trustedReview
          ? {
              acts: trustedReview.descriptors.acts,
              endings: trustedReview.descriptors.endings,
              truncated: trustedReview.descriptorsTruncated,
              needsReview: trustedReview.needsDescriptorReview,
              persistedStatus: trustedReview.persistedStatus,
              autoTaggerNeedsReview: trustedReview.autoTaggerNeedsReview,
            }
          : null,
        files: (s.files || []).slice(0, 4).map((f) => ({
          width: Number.isFinite(f.width) ? f.width : null,
          height: Number.isFinite(f.height) ? f.height : null,
          duration: Number.isFinite(f.duration) ? f.duration : null,
        })),
        findings,
        reasons: sceneReasons(collection, row, findings),
        findingExplanations: findingReasons(
          collection,
          row,
          findings,
          characterState,
        ),
        currentGaps: Object.entries(conditions)
          .filter(([k, v]) => v === true && k !== "character-unknown")
          .map(([k]) => k),
      };
    }),
  };
}
