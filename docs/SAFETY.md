# Foley safety

Foley sends recordings to a paid model, drives a browser with the model's
choices and runs test code the model wrote. This document describes how each
of those is bounded and what Foley refuses to do. Each control names the file
that enforces it.

## Spend governor

`src/ember.mjs` is the only module that calls the network, and every Muse
Ember request passes through its governor.

- **Fixed endpoint and model.** The base URL `https://api.meta.ai/v1` and the
  model `muse-ember-1.0` are constants. A request for another model is
  refused before any connection. Test mode accepts only a literal loopback
  address and its own synthetic key.
- **Hard stop at $9.00.** The cap is the constant `CAP = 9_000_000`
  micro-dollars. A larger cap found in the ledger is ignored. The event's
  limit is $10, so $1.00 stays as margin.
- **Reserve before send.** Under an exclusive lock on `out/ledger.json`, each
  request reserves its priced upper bound: every byte of the serialized
  request body priced as an input token, 1,600 tokens per image frame,
  2,000 tokens per second of video (the ceiling in `fixtures/ember/bounds.json`;
  251 per second was measured), and the full output ceiling. If baseline plus settled spend plus open
  reservations plus this bound would pass the cap, or the case budget, the
  request is refused with `budget_refused` and nothing is sent.
- **What the bound rests on.** The byte count is a safe ceiling for text,
  because a token is at least one byte. The media allowances are not
  provider guarantees. The video ceiling of 2,000 tokens per second is a
  chosen margin over one measurement (251 per second on one 16.56 s clip),
  and the frame allowance of 1,600 tokens is a margin over about 1,200
  measured. The provider publishes no maximum for either. A request that
  costs more than its reservation is recorded in full and stops every later
  call, but it cannot be undone. No request has cost more than its
  reservation in 2,231 recorded requests (ledger check on 2026-11-25).
- **The ledger is the record.** Spend figures are the usage the API reports
  at the published prices. They are not checked against the provider's
  billing page.
- **Case budget.** Every pipeline stage passes its issue's case budget with
  each request. The native computer-use call (`callEmberComputer`, a pilot
  interface that no stage uses) is refused without one, and each step of the
  live probe (`test/probe.live.mjs`) names one.
- **One price tier.** A request above 200,000 input tokens is refused.
- **Settle from usage.** After the reply, the reservation is replaced by the
  cost computed from the reply's token counts. A reply with no usage keeps
  its full reservation booked. A reservation left by a crashed process stays
  booked and is traced as recovery.
- **Bound violation stops spending.** If a reply's actual cost is above its
  reservation, the full cost is recorded and every later call is refused
  until an operator clears the stop.
- **Live calls need a baseline.** A live call is refused until the owner
  records the spend already made, with `node bin/foley.mjs baseline <micro-usd>`.
- **Envelopes.** `foley eval` (`--budget-usd`, at most $1.50) and
  `foley backlog` (`--budget-usd`, at most $3.80; `--per-issue-usd`, at most
  $0.40) refuse a larger budget before any request (`src/eval.mjs`).
- **Serial calls.** Paid calls run one at a time. `src/backlog.mjs` does not
  start the next issue's request while one is in flight.
- **Trace.** Each request, refusal, recovery and baseline is one line in
  `out/trace.jsonl`, written inside the same lock. `foley spend` rebuilds the
  totals from the trace and fails with exit code 3 if they do not match the
  ledger.

The tests in `test/ember/` (50 cases) cover the cap at equality and one
micro-dollar over, concurrent reservations, crash recovery and each result in
the closed set.

## Sandbox for model-written tests

`src/prove.mjs` runs each candidate test through `tools/isolate.sh`. If the
sandbox cannot start, prove returns `refused_isolation` and runs no generated
code.

- New user, mount, PID and network namespaces. Loopback is down, so the test
  has no network.
- A pivot into a minimal root: read-only `/usr`, the read-only `node` binary,
  a private `/proc`, a tmpfs `/tmp` and `/work`. No other host path is
  reachable.
- `/work` is an overlay of the candidate over the target build. Its writable
  layer is a size-capped tmpfs, so nothing the test writes reaches the disk.
- An empty environment (`env -i`), so the API key is absent. No capabilities
  and `no-new-privs` (`setpriv`).
- A data-segment memory limit and a wall-clock `timeout`.
- For the `node-test` runner, the Node permission model also limits file
  access to `/work` and blocks child processes. Vitest needs child processes,
  so it relies on the namespaces and the pivoted root.

A test counts as a proof only when it fails on the bug build with the
predicate's observed and expected values, passes on the fixed build, and
repeats both results with no model call. `checkCoreProof` needs both exits on
record: non-zero on the bug build and 0 on the fixed build. Model-chosen
labels and test text are never evidence for a proof.

Test text can only reject a candidate. A target's configuration lists the
calls of its test API that set state directly (`refused_test_calls` in
`fixtures/pairs/pairs.json`; for Excalidraw, the `helpers/api` module,
`setAppState`, `updateScene`, `setState`, `h.app` and assignment to
`h.elements`). A candidate that uses one is not run (`seeds_state`), the rule
is fed back to the model, and an accepted test records the rule it passed.
This is a text match after removing whitespace. It stops the plain case, where
a test sets the failing state instead of reaching it through pointer and
keyboard input. It does not prove that a test it lets through exercises the
reported interaction: read the kept test.

A reproduction that the fixed build also shows is not the reported bug. For a
pair run, Foley replays the reproducing actions on the fixed build with no
model call. If the failure shows there too after the Watch rounds are used up,
the reproduction is recorded as `fixed_build_conflict`, no test is asked for
and the issue is an `attempted_miss`.

## Browser origin lock

`src/repro.mjs` drives Chromium through Playwright, in a fresh browser context
for each attempt.

- Every request whose origin is not exactly the app origin is aborted and
  recorded as `blocked`. Every WebSocket is closed and recorded.
- File URLs and downloads are blocked (`acceptDownloads: false`). Service
  workers are blocked.
- Only the declared actions run: `click`, `double_click`, `drag`, `move`,
  `scroll`, `type`, `key_press`, `wait`, `screenshot`, and the pointer
  actions `pointer_click`, `pointer_double_click`, `pointer_move` and
  `pointer_drag`. Any other action is dropped and recorded. Model text is
  never evaluated as script.
- Pointer actions name integer pixels of the fixed 1280 by 720 viewport
  (device scale factor 1), the size of every screenshot the model sees. A
  model turn with any coordinate outside the viewport, or not an integer, is
  refused whole before any action runs. A clicked point gets the same link
  and download checks as a selector target.
- At most 25 steps per attempt and 3 attempts.
- The reproduction verdict comes from `src/predicate.mjs` reading the page.
  The model's claim of success is stored for display only.

## Reporters' recordings

Recordings attached to public Excalidraw issues belong to their reporters.
Foley grants itself no right to republish them.

- The census (`fixtures/census/census.json`) and `media/PROVENANCE.json`
  store each recording's URL, size and SHA-256 only.
- Local copies go in `media/cache/`, which is ignored by Git. Foley itself
  never downloads media. It reads a file from `media/cache/` only when its
  digest matches the census, and refuses with `media_digest` otherwise.
- `tools/check-public.mjs` fails on any committed media file that has no
  provenance entry. The only committed recording is
  `fixtures/recordings/owned-basic-flow.mp4`, made by the project.
- Run folders, which hold a copy of the recording, live under `out/`. The
  public-boundary check fails on any file under `out/`.
- The published trace (`trace/<issue>/`) carries each request's prompt as
  text and every frame as a SHA-256 digest. The prompts are this repository's
  own source and the event asks for a prompt and token trace, so they are
  published (decision of 2026-11-25; the first design excluded them). The
  check reads each JSON trace's decoded strings and fails on a home path, a
  key shape or an inline `data:` URL.
- Security reports and recordings with personal or sensitive content are
  excluded at the census with the status `excluded_sensitive_or_security`.

## What Foley refuses to do

| Refusal | Where |
| --- | --- |
| Call any host other than `https://api.meta.ai/v1`, or any model other than `muse-ember-1.0` | `src/ember.mjs` |
| Spend past $9.00, past a case budget, or after a bound violation | `src/ember.mjs` |
| Make a live call before the baseline is recorded | `src/ember.mjs` |
| Send audio, which the probe did not show Ember understands, or a video part longer than 120 s or without its measured bound in `fixtures/ember/bounds.json` | `src/ember.mjs` |
| Read a recording that is not MP4, QuickTime or WebM, is over 50 MB or over 120 s, or cannot be decoded | `src/watch.mjs`, `src/run.mjs` |
| Accept a path outside the working directory (`outside_working_tree`) | `src/run.mjs` |
| Start while another run holds the lock (`run_active`) | `src/run.mjs` |
| Resume an issue with a different recording, revision, runner or fixture mode (`resume_mismatch`) | `bin/foley.mjs`, `src/backlog.mjs` |
| Keep, show or send back to the model any model text that looks like a credential, or quote a rejected value in a re-ask (`malformed_output`) | `src/run-schema.mjs`, `src/watch.mjs`, `src/repro.mjs`, `src/text-safety.mjs` |
| Run a generated test that uses a refused state-setting call (`seeds_state`) | `src/prove.mjs` |
| Count a reproduction that the fixed build also shows (`fixed_build_conflict`) | `src/run.mjs`, `src/run-schema.mjs` |
| Make a native computer-use call without a case budget | `src/ember.mjs` |
| Run model-written code outside the sandbox (`refused_isolation`) | `src/prove.mjs` |
| Post anything to GitHub | No write client exists; `src/report.mjs` writes a local file |
| Serve the live page on anything other than IPv4 loopback, or serve a file outside the run folder | `src/live.mjs` |

Refusals before a model call exit with code 2 and print
`foley: refused: <code>: <text>`.
