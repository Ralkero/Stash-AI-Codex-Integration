import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { Auth } from "../service/auth.mjs";
import { Store } from "../service/store.mjs";
import { acquireInstance } from "../service/instance.mjs";

test("revocation denies old credentials; re-pairing preserves the local owner", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "stash-ai-auth-"));
  const store = new Store(dir);
  await store.init();
  const origin = "http://localhost:9999";
  const auth = new Auth(store, [origin], 9998);
  await auth.init();
  const first = await auth.pair(auth.state.pairCode, origin);
  const req = () => ({
    headers: {
      origin,
      authorization: `Bearer ${first.token}`,
      "x-stash-ai-time": String(Date.now()),
      "x-stash-ai-nonce": randomUUID(),
    },
  });
  assert.equal(auth.authorize(req()), first.owner);
  await auth.revoke(`Bearer ${first.token}`);
  assert.throws(() => auth.authorize(req()), /AUTH_REQUIRED/);
  const resumed = new Auth(store, [origin], 9998);
  await resumed.init();
  assert.equal(
    (await resumed.pair(resumed.state.pairCode, origin)).owner,
    first.owner,
  );
});

test("instance lock prevents a concurrent companion and releases cleanly", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "stash-ai-lock-"));
  const release = await acquireInstance(dir);
  await assert.rejects(acquireInstance(dir), /INSTANCE_ALREADY_RUNNING/);
  await release();
  const releaseAgain = await acquireInstance(dir);
  await releaseAgain();
  await assert.rejects(fs.access(path.join(dir, "instance.lock")));
});
