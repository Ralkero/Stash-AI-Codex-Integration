// Audited descriptions of existing allowlisted tools, not a query translator.
// Capabilities are intersected with both saved catalog and current owner health.
export function searchCapabilities(
  toolNames = [],
  ownerTools = [],
  schema = 1,
) {
  const has = (name) => toolNames.includes(name);
  const owner = (name) => has(name) && ownerTools.includes(name);
  const entry = (level, tool, note) => ({ level, tool, note });
  const unavailable = entry(
    "unsupported",
    null,
    "Unavailable in this conversation or current owner. Start a new chat if its saved catalog lacks the required tool.",
  );
  const native = has("find_scenes")
    ? entry(
        "exact-native",
        "find_scenes",
        "Exact for the requested native filters; returned results remain paginated.",
      )
    : unavailable;
  const known = entry(
    "scene-only",
    "get_scene_characters",
    "Inspect explicit IDs or a bounded candidate set; no exhaustive global search/count.",
  );
  const identity = owner("get_scene_characters") && schema >= 6;
  const descriptor = owner("read_descriptor_review");
  const attention = has("find_library_attention_items");
  const bounded = (tool, note) => entry("bounded", tool, note);
  return {
    schema: 1,
    criteria: {
      author: native,
      franchise: native,
      ids: native,
      nativeTags: native,
      createdAfter: native,
      multipleAuthors: has("find_scenes")
        ? bounded(
            "find_scenes",
            "Post-filter one native candidate page; global matching total unknown.",
          )
        : unavailable,
      character: identity
        ? {
            present: attention
              ? bounded(
                  "find_library_attention_items",
                  "At most 40 candidate observations; owner classification; global intersection unknown.",
                )
              : known,
            absent: attention
              ? bounded(
                  "find_library_attention_items",
                  "Zero tags or complete owner exclusion; unknowns never count as absent.",
                )
              : known,
            unknown: entry(
              "scene-only",
              "get_scene_characters",
              "Known IDs or bounded candidate inspection only. Unknown is not an absence filter.",
            ),
          }
        : { present: unavailable, absent: unavailable, unknown: unavailable },
      completeness: identity
        ? entry(
            "scene-only",
            "get_scene_characters",
            "Classification completeness only for explicitly inspected IDs; no global filter.",
          )
        : unavailable,
      review: descriptor
        ? {
            pending: bounded(
              "read_descriptor_review",
              "One ID-sorted candidate page, at most 30; pending matching total unknown.",
            ),
            reviewed: entry(
              "scene-only",
              "read_descriptor_review",
              "Persisted reviewed state for known IDs; no global reviewed search.",
            ),
            other: entry(
              "scene-only",
              "read_descriptor_review",
              "Known-scene owner state only; not-pending is not reviewed.",
            ),
            unknown: entry(
              "scene-only",
              "read_descriptor_review",
              "Availability is not a searchable metadata property.",
            ),
          }
        : {
            pending: unavailable,
            reviewed: unavailable,
            other: unavailable,
            unknown: unavailable,
          },
      descriptors:
        descriptor && attention && schema >= 6
          ? bounded(
              "find_library_attention_items",
              "Assignment presence only, not completed review; at most 40 candidates.",
            )
          : unavailable,
      needsReview:
        descriptor && attention
          ? bounded(
              "find_library_attention_items",
              "Explicit owner flag on bounded candidates; global total unknown.",
            )
          : unavailable,
      variants: owner("read_variant_family")
        ? entry(
            "scene-only",
            "read_variant_family",
            "One declared family/page; not a global inconsistency query.",
          )
        : unavailable,
      original: entry(
        "unsupported",
        null,
        "Historical findings cannot be searched as current metadata. Clarify a current condition.",
      ),
      unsupported: entry(
        "unsupported",
        null,
        "No audited query support; do not silently drop this criterion.",
      ),
    },
    combination:
      "AND is a request, not automatic translation. Mixed owner/scene-only criteria require bounded fresh checks; never claim an exact intersection count or silently drop a criterion.",
  };
}
