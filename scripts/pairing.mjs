import path from "node:path";
import { randomBytes } from "node:crypto";
import { Store } from "../service/store.mjs";
const store = new Store(
  path.join(process.env.LOCALAPPDATA, "StashAICommandCenter"),
);
await store.init();
const state = await store.read("auth.json", { schema: 1, pairings: [] });
state.pairCode = randomBytes(32).toString("base64url");
state.pairExpires = Date.now() + 15 * 60 * 1000;
await store.write("auth.json", state);
console.log("One-use pairing code: " + state.pairCode);
