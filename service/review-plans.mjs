import { object } from "./validation.mjs";
import { uniqueIds } from "./relationships.mjs";
import { hydrateScenes } from "./scene-cards.mjs";
import { recommendations } from "./recommendation-policy.mjs";
import {
  assessScene,
  reviewSummary,
  REVIEW_LIMITATIONS,
} from "./review-policy.mjs";

export async function reviewScenes(stash, adapters, args, decisions, owner) {
  object(args, ["sceneIds"]);
  const sceneIds = uniqueIds(args.sceneIds, 20);
  // Reuse the audited three-batch projection and its native/owner join checks.
  // Images/files are excluded; bounded Character evidence goes to the model,
  // but sourceRows persists only the unchanged fixed review snapshot.
  const hydrated = await hydrateScenes(stash, adapters, {
    sourceTool: "review_scenes",
    observedAt: new Date().toISOString(),
    scenes: sceneIds.map((sceneId) => ({ sceneId, findings: [] })),
  });
  const scenes = hydrated.scenes.map((scene) => ({
    sceneId: scene.sceneId,
    status: scene.status,
    review: assessScene(scene),
    recommendations: recommendations(
      scene,
      decisions,
      owner,
      hydrated.observedAt,
    ),
    characters: scene.characters
      ? {
          presence: scene.characters.presence,
          completeness: scene.characters.completeness,
          recognized: scene.characters.names.slice(0, 4),
          recognizedTruncated: scene.characters.names.length > 4,
          unclassifiedCount: scene.characters.unclassifiedCount,
          explanation: scene.characters.explanation,
        }
      : null,
  }));
  return {
    observedAt: hydrated.observedAt,
    atomic: false,
    scenes,
    summary: reviewSummary(scenes),
    limitations: REVIEW_LIMITATIONS,
    nextActions: {
      gaps: "Requires clarification of intended existing entity; fresh read and ID resolution before preview.",
      ownerReview:
        "Requires investigation; pending review does not identify an incorrect descriptor.",
      uncertain:
        "Classification limitation, not a confirmed metadata error. Explain the available tag evidence; do not suggest edits just to remove this note.",
      readyToCorrect: false,
      limits:
        "Native preview: 5 scenes; Descriptor preview: 1 scene; one proposal attempt per turn. Explicit UI approval only. Do not automatically chain batches.",
    },
  };
}
