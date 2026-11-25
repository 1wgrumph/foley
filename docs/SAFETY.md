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
  request body priced as an input token, 1,600 tokens per image frame, and
  the full output ceiling. If baseline plus settled spend plus open
  reservations plus this bound would pass the cap, or the case budget, the
  request is refused with `budget_refused` and nothing is sent.
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
repeats both results with no model call. Model-chosen labels and test text
are never evidence.

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
- Security reports and recordings with personal or sensitive content are
  excluded at the census with the status `excluded_sensitive_or_security`.

## What Foley refuses to do

| Refusal | Where |
| --- | --- |
| Call any host other than `https://api.meta.ai/v1`, or any model other than `muse-ember-1.0` | `src/ember.mjs` |
| Spend past $9.00, past a case budget, or after a bound violation | `src/ember.mjs` |
| Make a live call before the baseline is recorded | `src/ember.mjs` |
| Send video or audio parts, which it cannot price yet | `src/ember.mjs` |
| Read a recording that is not MP4, QuickTime or WebM, is over 50 MB or over 120 s, or cannot be decoded | `src/watch.mjs`, `src/run.mjs` |
| Accept a path outside the working directory (`outside_working_tree`) | `src/run.mjs` |
| Start while another run holds the lock (`run_active`) | `src/run.mjs` |
| Resume an issue with a different recording, revision, runner or fixture mode (`resume_mismatch`) | `bin/foley.mjs`, `src/backlog.mjs` |
| Store a model explanation that is too long or looks like a credential (`malformed_output`) | `src/repro.mjs`, `src/text-safety.mjs` |
| Run model-written code outside the sandbox (`refused_isolation`) | `src/prove.mjs` |
| Post anything to GitHub | No write client exists; `src/report.mjs` writes a local file |
| Serve the live page on anything other than IPv4 loopback, or serve a file outside the run folder | `src/live.mjs` |

Refusals before a model call exit with code 2 and print
`foley: refused: <code>: <text>`.
