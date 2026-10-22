# Descriptor transaction contract v1

v0.7.0 compatibility note: exact owner releases **0.9.20 and 0.9.21** are audited.
0.9.21 adds a separate read-only Character identity module; descriptor rules and
mutation plan semantics are unchanged. Responses must match the live owner
version. No journal migration (still schema 3), review-state edit or added write
permission. The historical v0.4.0 specification below remains applicable.

New proposals record the actual validated owner envelope version, not the oldest
compatible version. Approval rechecks that version and the complete plan;
dispatch checks the version again before invoking the owner. Version drift
requires a fresh preview. Historical journal records are never relabeled.

## Scope and ownership

Supported owner: scene-auto-tagger **0.9.20**. Companion/UI **0.4.0**, model tool
contract **4**, descriptor journal record schema **3**. Existing native journal
schemas 1/2 are retained without migration. Config/auth/public browser API remain 1.

The authoritative persisted representation is JSON string arrays under
`r34_sex_acts_positions` and `r34_ending_descriptors`, not tag relationships.
Definitions have no numeric identity table. The owner derives names/categories
from its UI `ACT_ALIASES` / `ENDING_ALIASES` and exposes category-qualified references
`acts:${encodeURIComponent(name)}` / `endings:${encodeURIComponent(name)}`.
Current-scene custom assignments can be read but cannot be modified by this API.
Aliases aid the UI; external resolution uses canonical names, not guessed aliases.

`descriptorAssignmentFields` is the extracted **existing UI serializer**. Both the
manual save and server transaction use it. `build-ai-read.cjs` embeds that helper,
the exact owner vocabulary, normalization, uniqueness and Rule34 eligibility rules
into the single Stash JS entrypoint. `--check` detects stale generation. The manual
UI still sets reviewed/source when the human uses its Save workflow; external
descriptor-only corrections deliberately do not invoke that broader workflow.
No inference, learned correction, task queue, cache initialization or new taxonomy.

## Interfaces

Model tools (never an apply tool):

- `resolve_descriptors({query, sceneId?})`: canonical-name search; exact/ambiguous/
  similar_only/no_match, category/reference/editable flag. Up to 30 returned matches.
- `preview_descriptor_update({sceneId, add?, remove?})`: omitted lists are empty;
  explicit null is invalid. 1–12 distinct references total, no add/remove conflict.
- `preview_descriptor_update({compensateId})`: no other arguments allowed. Original
  proposal must belong to this conversation, be verified/reconciled, and still
  match its captured post-result state. Produces a new approval, not an execution.
- `get_change_status({id})`: reads durable result. Uncertain descriptors receive
  read-only reconciliation; never dispatches a mutation.

Fixed server transport: `runPluginOperation(plugin_id:"scene-auto-tagger",
args:{mode:"descriptor_transaction_v1", kind,...})`. Kinds: capabilities, resolve,
preview, apply. Model arguments cannot select a plugin ID, mode, kind, GraphQL,
custom fields, expected snapshot, restoration map or approval reference.

`preview` takes the validated command and optionally exact `expected` state; owner
returns before (scene ID, updated_at, four descriptor/review fields), after fields,
current/proposed/added/removed names and categories, mutation plan, noOp and count.
`apply` requires UUID operationId, command.expected and the approved owner plan.
The owner rereads, validates identity/eligibility/vocabulary and compares canonical
object representations before a single narrow partial/remove mutation. Go Map key
ordering is not significant. Review status/source are checked but never sent in
the mutation. Owner readback compares descriptor/review fields. Response envelopes
carry API version, owner/version, observed time, readOnly and outcome/operation ID.

The companion validates response bounds, field allowlists, reference/name/category
consistency, requested semantic deltas and exact mutation-to-preview correspondence.
Exact owner version/enabled state is checked on every call. Eight-second inventory
and 15-second operation deadlines fail closed. A timed-out apply may continue in
Stash: it is uncertain, not cancelled, and must never be resent.

## Approval, persistence, recovery

The existing companion is the **sole durable dispatch authority**. The owner VM is
stateless; Stash creates it per operation and exposes neither files nor a shared
lock. There is no second pseudo-ledger in plugin settings and no standalone claim
that direct privileged owner calls have durable idempotency. Direct Stash API
callers already have mutation authority and are outside the paired-AI boundary.

1. Preview reads owner state plus the existing full scene guard. The journal binds
   owner/thread, operation UUID, expiry, exact command/plan, public diff, captured
   fields and hashes of protected metadata. No write occurs.
2. Only the existing authenticated UI decision route may approve. Integrity,
   ownership, expiry, owner version, full scene guard and fresh owner plan are
   revalidated. One serialized companion queue covers native and descriptor writes.
3. Persist `applying`, approvedAt and approvalReference **before dispatch**. Store
   writes use exclusive temporary creation, file sync and atomic replacement.
4. Call the owner exactly once. Independently read approved fields plus hashes for
   all captured unrelated fields and all other custom fields. Record verified,
   reconciled or uncertain. Preserve original before-state and result evidence.
5. Repeated decisions return the durable outcome. On restart, applying becomes
   uncertain. Never resend even if the old before-state remains. Read-only status
   can reconcile an exact expected result; mismatches stay uncertain and block
   new descriptor/native proposals for that scene. A manually audited resolution
   is needed if exact expected-state reconciliation is impossible; no UI override.
6. Separate compensation validates the original integrity and complete verified
   post-state, then asks the owner to preview the inverse references. Internal
   restoration is limited to the original two raw assignment values (including
   absent fields and order), and must semantically equal that validated inverse.

States: pending → rejected/cancelled/superseded/stale, or applying → verified /
reconciled / uncertain. No-op is terminal and never dispatches. Sending a new user
message cancels old pending previews; failed attempts consume the shared per-turn
proposal budget. Old conversations keep their original tool catalogs.

## Limits and operational guidance

- Stash sceneUpdate has no compare-and-swap. A concurrent external editor/hook can
  race the last read and write. Readback detects many side effects but cannot make
  the database update and local journal one atomic transaction or prove causation.
- Avoid simultaneous manual/AI edits. A Descriptor Review tab already open in
  another page is not remotely rewritten; reload/reopen it before saving. Its
  existing local draft/undo behavior is unchanged, not a cross-editor lock.
- No automatic retry, forced undo, multi-scene descriptor edits, review completion,
  arbitrary custom vocabulary edits, learning, Variant/Preferences/queue mutations.
- File sync improves process-crash durability; no universal power-loss guarantee
  or protection against privileged journal tampering/rollback is claimed.
- Owner responses are trusted versioned code, not a sandbox against a malicious
  same-user plugin. Existing shared-origin and local-admin trust assumptions apply.
- UI displays explicit categories/IDs, added/removed/unchanged values, operation ID,
  review effect and normal Approve/Reject/Cancel. No floating editor or new hotkeys.

## Tests and deployment

Run `npm test`, `npm run check`, `node scripts/security-validation.mjs`.
`tests/descriptors.test.mjs` executes the generated exact owner transaction block
against an isolated GraphQL transport; `tests/service.test.mjs` exercises real HTTP
and UI-approval authentication against fixture data. Production checks are strictly
read-only in `scripts/validate-live-040.mjs`. A production approved mutation and
restoration need separate human clicks; fixtures are not that proof.

`scripts/capture-040-integration.mjs` captures baseline-relative owner deltas and the
generated test block in integration/0.4.0, without staging the dirty owner checkout.
Never apply those patches blindly to a different baseline. Backups live outside
active Stash plugin paths. Roll back code only, retaining current auth, conversations
and proposals, especially uncertain records. See REPORT-0.4.0 for exact deployment.
