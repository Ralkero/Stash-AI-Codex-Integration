// Offline operator utility. Input contains fresh snapshots and separately
// reviewed evidence; it is never a mutation manifest or a model-facing tool.
import fs from "node:fs";
import { reconcileAll, fingerprint } from "./lib/identity-reconciliation.mjs";
const [input, output] = process.argv.slice(2);
if (!input || !output)
  throw Error(
    "Usage: node scripts/reconcile-identities.mjs PRIVATE_INPUT.json NEW_PRIVATE_OUTPUT.json",
  );
const data = JSON.parse(fs.readFileSync(input, "utf8"));
const scenes = reconcileAll(data);
fs.writeFileSync(
  output,
  JSON.stringify(
    {
      schemaVersion: 1,
      sourceFingerprint: fingerprint(data),
      approval: false,
      execution: false,
      scenes,
    },
    null,
    2,
  ) + "\n",
  { flag: "wx" },
);
console.log(
  JSON.stringify({
    scenes: scenes.length,
    changed: scenes.filter((r) => r.status === "candidate").length,
    conflicts: scenes.reduce((n, r) => n + r.conflicts.length, 0),
    productionWrites: 0,
  }),
);
