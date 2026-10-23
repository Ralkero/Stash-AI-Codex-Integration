import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import { TagCleanupAdapter } from "./tag-cleanup-adapter.mjs";
import { id, check } from "./validation.mjs";
export class ExactCharacterAdapter extends TagCleanupAdapter {
  async environment() {
    const environment = await super.environment();
    const root = path.join(os.homedir(), ".stash/plugins/scene-auto-tagger");
    const ownerHashes = {};
    for (const n of [
      "scene-auto-tagger.js",
      "identity-eligibility-source.js",
      "identity-local-review.json",
    ])
      ownerHashes[n] = createHash("sha256")
        .update(await fs.readFile(path.join(root, n)))
        .digest("hex");
    return { ...environment, exactCharacterSchema: 1, ownerHashes };
  }
  async scene(sceneId) {
    const r = await this.stash.query(
      "query($id:ID!){findScene(id:$id){id title details rating100 updated_at created_at date code director urls organized custom_fields tags{id name} studio{id name} performers{id name} groups{group{id name} scene_index} galleries{id} stash_ids{endpoint stash_id} files{basename width height}}}",
      { id: id(sceneId) },
    );
    check(r.findScene, "SCENE_NOT_FOUND");
    return r.findScene;
  }
  async definitions(values) {
    check(values.length > 0 && values.length <= 50, "EXACT_TAG_LIMIT");
    values.forEach(id);
    const r = await this.stash.query(
      `query(${values.map((_, i) => `$t${i}:ID!`).join(",")}){${values.map((_, i) => `t${i}:findTag(id:$t${i}){id name description aliases ignore_auto_tag parents{id name}}`).join(" ")}}`,
      Object.fromEntries(values.map((v, i) => ["t" + i, v])),
    );
    return values.map((_, i) => r["t" + i]);
  }
  // Inherits only the audited one-scene BulkSceneUpdate REMOVE construction.
  // Never accepts a replacement full Tag array, additions or definition writes.
}
