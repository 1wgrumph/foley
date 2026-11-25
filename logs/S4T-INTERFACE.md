# S4T stage interfaces

S4T establishes callable and file contracts for the five independent
product groups. All prices and budgets use integer micro-dollars. Files
named by a run document are relative to its run folder; absolute paths
and paths outside that folder are not valid artifact references.

The repaired Ember contract in [W2R-INTERFACE.md](W2R-INTERFACE.md)
is authoritative for all five groups. Offline authentication uses
only `FOLEY_TEST_API_KEY`; live mode uses only `MODEL_API_KEY`.
The test endpoint is a literal loopback HTTP address ending in `/v1`.
Do not forward either credential to browsers, non-model tools or
generated test runners. The client must reject redirects.

The caller still supplies `max_output_tokens`, but the normalized
wire body is `{model, messages, max_completion_tokens}`. The upper
bound includes all UTF-8 bytes of the serialized wire JSON, not only
prompt text. For inline PNG frames, count the normalized body with
each image URL replaced by an empty string, then add 1,600 input
tokens per image. Both dimensions must be 1 to 1280 pixels. Price
all bounded input at the uncached input rate and reserve the full
output ceiling. The exact wire bytes determine `request_digest`;
the prompt record retains text and decoded media digests only.
Replies must contain a JSON string encoding a non-null object. If
known usage exceeds its reservation, retain the full actual cost,
record `bound_violated: true`, and honor the persisted budget stop:
later calls refuse without network, even with global headroom.

## Group a: watch, report, backlog, score, schema and spend

### Watch

`src/watch.mjs` exports:

```js
async watch(recordingPath, {
  runDir, callEmber, probe, caseId, caseBudget
})
```

The result is `{status, document?}`. On success, status is `ok` and
`document` is the steps document written to `runDir/steps.json`:

```js
{
  schema: "foley.steps/1",
  steps: [{ order: 1, t_s: 1, action: "click",
            target: "Archive", selector: "#archive" }],
  predicate: { kind: "visible_text", selector: "#status",
               expected: "Archived", observed: "Not archived" },
  mediaPath: "frames" // "video" is also valid
}
```

A step has a one-based order, timestamp in seconds, declared action and
target text. Optional fields include selector and value. Actions are
`click`, `double_click`, `drag`, `move`, `scroll`, `type`,
`key_press`, `wait`, `screenshot`. The owned correct-behaviour clip
has a null predicate; ordinary bug steps carry a typed predicate.
Narration and transcript are absent for silent clips. Model output is
the steps document without the client-added `mediaPath`.

The probe object has `video` and `audio` entries, each containing
`{accepted: boolean, tokensPerSecond?: number}`. Only accepted,
bounded media can be tried. Send video via `video_url`; bounded video
refusal falls back to `image_url` parts sampled at 1 fps, at most 40,
inline PNG at most 1280 pixels on either axis. Audio, when present
and accepted, uses `audio_url`. Each media part contains a matching
field `{url}`. The current actual client cannot price video or audio,
so it refuses those parts before sending; use the frames path until
measured bounds are implemented.
Write `runDir/watch.trace.jsonl` with an event whose `path` is
`video` or `frames`. Invalid type, size above 50 MB, duration
above 120 seconds or unreadable media returns `refused_input`
before sending. Schema-invalid model output returns `malformed_output`.

Tests inject an Ember-compatible async function. It takes
`{messages, max_output_tokens, caseId, caseBudget?, timeoutMs?}` and
returns the existing Ember result `{status, output?, message?}`.
The frame path uses real Ember against the local fake server. The
bounded-video transport control uses a test-only HTTP adapter because
the current governor refuses video and audio before sending. The
adapter sends the same wire shape and synthetic offline bearer token
to the fake server and rejects redirects; it is not governor coverage.

### Report

`src/report.mjs` exports `async report(run, {runDir})`, returning
`{status: "ok", path?: "comment.md"}`. Write `runDir/comment.md`
with headings Steps, Code anchors, Test, Verdict and Cost. Include
the fixture values, file:line anchors, the regression-test path,
the verdict and cost in USD with six decimal places. When no test
exists, the Test section states `none`. No upstream write.

### Backlog

`src/backlog.mjs` exports:

```js
async backlog(census, {
  runRoot, stages,
  stopAfter, // optional {issue, stage} completed-stage boundary
  maxIssues  // optional limit on newly attempted issues; 0 reports only
})
```

The census uses `foley.census/1`, with `generated_on`,
`repository`, `target_revision`, and `candidates`. Each candidate has
numeric `issue`, `url`, `media` and exactly one `status`. Existing
preflight census entries can include more metadata.

Each injected stage is an async function of
`(candidate, {runDir, ...context})`. Run stages in order: watch,
locate, repro, prove, report. Stage results include `status` and, when
applicable, `cost_micro_usd`. The fixture's model-backed watch
returns `ok` or a typed Ember miss; locate returns `ok`;
repro returns `reproduced`; prove returns `verified`; report
returns `ok`. The injected stage functions allow the scheduler to
be tested before the other product stages exist.

The result is `{status, report}` with status `ok`, `interrupted`
or `refused_input`. Write report array to
`<parent of runRoot>/backlog-report.json`. Each row contains
`{issue, status, cost_micro_usd}`, with the seven exact status
strings from the preflight census:

- `no_usable_media`
- `unsupported_device`
- `excluded_sensitive_or_security`
- `eligible_not_attempted`
- `attempted_miss`
- `failure_observed`
- `proof_verified`

Unknown status or corrupt state refuses the run. Store state at
`runRoot/<issue>/state.json`. The public field `completed` lists
finished stage names in order. Persist enough progress and cost to
resume, keep crashed reservations booked, allow an interrupted stage
at most one additional execution, and never repeat a completed stage.
All issue processing is serial; do not prefetch a later issue's model
request while the current one is in flight.

### Score

`src/score.mjs` exports the pure function `score(results, labels)`.
Results are an array of
`{issue, status, anchors:[{file,...}], cost_micro_usd, elapsed_ms}`.
Labels are `{schema:"foley.labels/1", entries:[{issue, expected_file}]}`.
Return:

- `success_per_attempt`: observed failures or verified proofs divided
  by attempted issues.
- `success_per_eligible`: observed failures or verified proofs divided
  by eligible issues (including eligible not attempted).
- `top1`, `top5`: correct expected file at top one or within top five
  divided by labelled issues.
- `cost_per_attempt_micro_usd`, `cost_per_verified_proof_micro_usd`:
  total attempted cost divided by attempted issues or verified proofs.
  The latter is null when no proof is verified.
- `elapsed_ms`: sum of elapsed times.
- `misses`: issue IDs of eligible issues without observed failure,
  including eligible not attempted, in input order.

### Run schema and spend

`src/run-schema.mjs` exports `validateSteps(document)` and
`validateRun(run)`, returning booleans. Unknown state or malformed
required fields are invalid. Shared run document, consumed by groups
u and i:

```js
{
  schema: "foley.run/1",
  issue: 1,
  issue_url: "https://example.invalid/issues/1",
  target_revision: "<pinned revision>",
  fixture: true, // synthetic control, not a real core proof
  state: "finished",
  recording: "recording.mp4",
  steps: [/* steps as above */],
  predicate: { kind: "visible_text", selector: "#status",
               expected: "Archived", observed: "Not archived" },
  anchors: [{ file: "logic.mjs", line: 2, term: "Archive" }],
  replay: {
    screenshots: [{ path: "screenshots/step-1.png", t_s: 1, action: "click" }],
    events: [{ type: "action", action: "click", t_s: 1, detail: "Archive" }]
  },
  test: { path: "regression.test.mjs", verdict: "verified" },
  verdict: "proof_verified",
  cost_micro_usd: 152,
  error: null
}
```

State is one of `empty`, `running`, `error`, `disconnected`,
`finished`. Incomplete runs can have null recording, predicate,
test or verdict; arrays are empty before their stages run. Error is
null or a descriptive string. Replay events may also record blocked
and dropped actions and recovery. All paths used for assets stay
inside the run folder.

`async writeSpendSummary(outDir)` reads `ledger.json` and
`trace.jsonl` and writes and returns `spend-summary.json`:
`{baseline, settled, booked, total, per_stage}`. Sum settled and booked
event deltas, not running totals, and reconcile against the ledger.
Per stage is a mapping of stage name to total charged or booked.
A trace event's `stage` field takes precedence. Existing Ember trace
events carry a `callId` but no stage name: accept optional
`stage-spend.jsonl` entries `{callId, stage}` to attribute them.
Unattributed costs must still appear in the total; do not fabricate
stage attribution. Reject a ledger/trace mismatch before writing a
new summary. Journal or recovery metadata from W2R is permitted;
sum known actual costs in full even when `bound_violated` records
a stop.

`async checkCoreProof(runDir)` returns `{status}` with `ok`
for intact proof and `digest_mismatch` for an edited artifact.
It checks `core-proof.json` against `artifact-trace.jsonl` and
the SHA-256 of each referenced artifact. The core proof record has
schema `foley.core-proof/1`, `issue_url`, `target_revision`,
`fixture` (true only for synthetic controls), `stages`,
`rerun_without_ember`, `unedited`, and `artifacts` (relative
path to SHA-256 map). Artifact trace events are
`{type:"artifact", path, sha256}`. Missing, changed or outside
artifacts must not count as verified. Manifest and trace are not
self-referential artifacts.

## Group b: locate and BRAN media evidence

`src/locate.mjs` exports:

```js
async locate(stepsPath, { targetDir, targetRevision, runDir })
```

Return and write `runDir/anchors.json`:

```js
{
  schema: "foley.anchors/1",
  status: "ok", // or "miss"
  anchors: [{ file: "logic.mjs", line: 2, term: "Archive" }]
}
```

Every file is repository-relative and every line is one-based at the
pinned revision. Rank deterministically. A miss has zero anchors.
Do not call Ember or open a network socket. The test pins a small
Git snapshot of the owned archive app and labels `logic.mjs` as the
expected top-five file. The network-denial test runs the actual JS
adapter and binary inside an unshared network namespace under strace.

The crate at `foley-crates/bran-media-evidence` exposes the library:

```rust
pub fn locate(repo_root: &std::path::Path, steps_path: &std::path::Path)
    -> Result<String, String>;
```

Return the versioned JSON document above as a string. Binary
`bran-media-evidence --repo <repo-dir> --steps <steps.json>` emits
the same document to stdout and exits zero on valid input. The
Node layer supplies and checks the pinned target revision. The
Rust integration test compares library and CLI output on the
same fixture. Build and test the crate via CMD-BRAN; keep the
vendored BRAN source unchanged and use its library query.

## Group c: reproduction, predicate, proof

### Browser reproduction

`src/predicate.mjs` exports `async checkPredicate(page, predicate)`,
returning true only when the specified failure is observed on the
actual page. The fixture predicate is `visible_text`, with
`selector`, `expected`, `observed`. Do not accept the model's verdict
as a predicate result. The design additionally allows count, canvas
state and console-error checks.

`src/repro.mjs` exports:

```js
async repro(steps, predicate, appOrigin, {
  runDir, caseId, caseBudget, callEmber, scripted, maxOutputTokens
})
```

`scripted: true` executes the input steps without a model call.
Otherwise use the observe-act loop with injected `callEmber`, which
takes the S2 arguments above. Pass the case ID and budget to each
call. When supplied, `maxOutputTokens` is the explicit
`max_output_tokens` for model calls, enabling the one-attempt budget
control. Model requests with screenshots use bounded inline PNG.
The one-attempt test supplies 6,000 output tokens and 5,500
micro-dollars: the first charge is 3,001, and the remaining 2,499
cannot cover another 3,000-output reservation even before input.
The test checks each actual reservation against the captured framed
wire body and its settled digest, and distinguishes a case-budget
refusal from a bound-violation stop. Model output shape:

```js
{ actions: [/* declared actions with target/selector/value */],
  done: true, verdict: "reproduced" }
```

`done` ends that attempt, not the independent predicate check.
At most three attempts, each in a fresh browser context; stop at
budget refusal. Return and write `runDir/replay.json` with:

- `status`: `reproduced` or `not_reproduced`.
- `observed`: actual predicate boolean.
- `attempts`: array of `{contextId, observed, ...}` with distinct
  context IDs.
- `screenshots`: array of `{path,t_s,action}` referencing PNG files
  in the run folder.
- `events`: array of `{type, action?, reason?, detail?, t_s?}`.
  Executed action uses type `action`, undeclared action uses
  `dropped_action` and its original action name. Blocked action uses
  type `blocked` with reason `origin`, `file_url` or `download`.

An app build starts at its exact origin; other origins, file URLs and
downloads are blocked. The owned app's Archive button displays
`Not archived` on the bug build and `Archived` on the fixed build.
The Touch button contaminates a context, making the archive bug
unobservable until a fresh context is started. This is the retry
freshness control: a false model success cannot bypass the predicate.

### Proof

`src/prove.mjs` exports:

```js
async prove(steps, anchors, predicate, {
  runDir, targetDir, fixedTargetDir,
  runner, callEmber, caseId, caseBudget, timeoutMs, memoryMiB
})
```

Use the supplied target's runner. `runner: "node-test"` is the
owned tiny fixture's runner; the real target pin remains Vitest.
The model candidate output is
`{code, filename:"regression.test.mjs", assertion:"archive-status"}`.
Candidate code is untrusted. The positive fixture drives the same
Archive transition through its shared application logic, and asserts
the expected visible result with the named predicate assertion.
Reject missing, unrelated or unconditional assertions. Run only
in a disposable copy with an empty credential-free environment,
network denied, filesystem confined and time/memory limits.
`FOLEY_DISABLE_ISOLATION=1` is the forced-unavailable test flag;
it must refuse before asking for candidate code or starting a runner.
It must never disable isolation for execution.

Return `{status, attempts, path?, reason?, rerun_without_ember?}`
and write `runDir/proof.json` with that result. Status is
`verified`, `not_verified` or `refused_isolation`.
Each executed attempt records `sandboxPath` (removed before returning),
`reason`, and `bug` and when applicable `fixed` runner results
`{exitCode, output}`. A killed run can have null exit code.
The reason values exercised by tests are `verified`,
`import_error`, `syntax_error`, `timeout`, `unconditional_failure`,
`wrong_predicate`, `network_denied`, `filesystem_denied`,
`memory_limit`. At most four candidate rounds; no accepted test
file on rejection. Refused isolation has empty attempts and a reason
naming isolation.

Accepted result writes the candidate exactly to
`runDir/regression.test.mjs`, sets `path` to that relative name,
records bug exit 1 for the archive-status assertion and fixed exit 0,
and reruns the same test without another model call. The public
`rerun_without_ember` contains `{bug:{exitCode}, fixed:{exitCode}}`.
Synthetic file/network probes target only owned temporary sentinels
and a decoy loopback server. The generated test must not receive
the parent synthetic offline credential or sentinel. Both
`FOLEY_TEST_API_KEY` and `MODEL_API_KEY` must be absent.
Do not propagate
untrusted code output containing credentials.

## Group u: replay page and live server

`ui/render.mjs` exports `async renderReplay(runDir)`. It consumes
`runDir/run.json` (schema in group a), reads only assets in that folder,
and writes `runDir/replay.html`. The UI build command is
`npm run build:ui`; the product group owns its script and built assets
under `ui/dist/`. Static replay is self-contained with inline media
(data or self-contained Blob URLs). It opens from a file URL and
makes no other file or remote request.

Stable observable DOM identifiers:

| data-testid | Observable content |
| --- | --- |
| recording | Visible original video with controls |
| replay | Visible screenshot/image of the replay |
| steps | Ordered step text |
| location | File:line anchors |
| test | Regression-test path, or explicit absence |
| verdict | Verdict matching run document |
| cost-meter | USD cost formatted with six decimals |
| run-state | State text: empty, running, error, disconnected, finished |
| action-feed | Visible action/recovery text; data-event-count is the number of replay events |

Run text is rendered as text, never HTML. The text-boundary control
uses inert markup-shaped strings and verifies no injected element.
The UI must work in five states at 1280x800 and 390x844, have no
horizontal overflow or console error, have keyboard-reachable
controls, pass axe with no serious/critical findings, and expose
text contrast at least 4.5:1. The tests retain viewport screenshots
and axe JSON in unique directories under `out/ui-evidence/`.

`src/live.mjs` exports `async startLive(runDir, {host?}={})`.
Return `{origin, address:{address,port}, close()}`; address must be
127.0.0.1 on an ephemeral port, origin its HTTP URL, close async.
Reject wildcard/non-loopback host configuration. The server is
read-only and serves the live page at `/`, current `/run.json`,
and in-folder assets. Refuse outside paths and PUT/POST. The live
page polls actual run data, updates action feed and cost, and retains
the last data in disconnected state if the server stops.

## Group i: CLI and integrated pipeline

`bin/foley.mjs` is the executable Node entry. The offline control
runs:

```sh
node bin/foley.mjs run 1 --issue-url https://example.invalid/issues/1 \
  --fixture --recording <recording.mp4> --target <repo> \
  --revision <pinned-commit> --fixed-target <fixed-repo> \
  --app-origin <loopback-origin> --runner node-test \
  --case-budget 100000 --probe <probe.json>
node bin/foley.mjs spend
```

The `--fixture` marker distinguishes synthetic integration evidence
from real issue proof. Use the probe file and call the actual
stages in sequence. The test records a real owned two-frame clip
from the seeded app; the fake server supplies corresponding watch,
repro and proof outputs. Environment for offline model calls:
`FOLEY_OFFLINE=1`, `FOLEY_EMBER_BASE_URL` points at the local fake
base ending in `/v1` with a literal loopback address,
`FOLEY_TEST_API_KEY` is synthetic; do not supply
`MODEL_API_KEY` in offline mode. The actual
Ember ledger and trace are under `out/` relative to cwd. Never
call a real model endpoint from this run.

Exit zero for verified proof. Write `out/runs/1/` with
`recording.mp4`, `steps.json`, `anchors.json`, `replay.json`,
`proof.json`, `regression.test.mjs`, `comment.md`, `replay.html`,
`run.json`, `core-proof.json`, `artifact-trace.jsonl` and
screenshots. The run schema is in group a. Complete artifact digests
must agree with the trace; removing a stage artifact must fail proof
validation. Do not count synthetic proof as real-issue evidence.
The CLI `spend` invokes the schema group's spend-summary operation
and exits nonzero on reconciliation error. Record stage attribution
using `out/stage-spend.jsonl` mapping Ember call IDs to stage names
when the base trace has no stage field. The integrated spend summary
must reconcile exactly and attribute watch, repro and prove costs.

With `--live`, start the read-only server before the first model
request and print `LIVE_URL=http://127.0.0.1:<port>` to stdout
when ready. Atomically publish the initial run and updates as
stages finish and real browser actions occur. The live test holds
scripted replies while observing the actual pipeline and compares
two DOM reads at least two seconds apart against `run.json`. It
retains both snapshots in `out/live-evidence/`. Stop serving on
termination; the page retains last data and reports disconnected.
