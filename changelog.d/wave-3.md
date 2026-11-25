### Added

- Locate slice S4b. New event-built crate
  `foley-crates/bran-media-evidence` maps `foley.steps/1` to ranked
  `foley.anchors/1` file and line anchors. It calls the vendored BRAN v0.4.0
  library (repository scanner and graph query) and leaves `vendor/bran`
  unchanged. `src/locate.mjs` runs its binary, checks every anchor against the
  pinned target revision, refuses paths that leave the target tree and writes
  `anchors.json` atomically. No model call and no network socket.
- Stage group a (S4a). `src/watch.mjs` checks a recording's type, size and
  duration before any request, samples frames with ffmpeg (1 fps, at most 40,
  at most 1280 px), and tries bounded video only when the probe or
  `fixtures/ember/bounds.json` allows it. Model replies must pass
  `validateSteps`. `src/backlog.mjs` runs a dated census serially and resumes
  without repeating a finished stage. `src/report.mjs` writes the draft comment
  with untrusted text in code spans. `src/score.mjs` computes the evaluation
  quantities. `src/run-schema.mjs` validates steps and run documents, writes the
  reconciled spend summary and checks core-proof artifact digests.
- Each run can export a self-contained replay with linked recording and browser
  frames, action costs, code anchors, and regression-test results. The read-only
  loopback viewer follows new run records and keeps the last received frames
  available after disconnect.
- Stage group c (S4c). `src/repro.mjs` drives Chromium through Playwright
  from scripted steps or model-chosen actions, at most three attempts, each in
  a fresh context locked to the app origin. Other origins, file URLs, downloads
  and undeclared actions are blocked or dropped and recorded in `replay.json`.
  `src/predicate.mjs` decides the result from the page alone; the model's
  verdict never counts. `src/prove.mjs` asks for a regression test, at most
  four rounds, and runs each candidate through `tools/isolate.sh`: new user,
  mount, PID and network namespaces, an empty environment, a tmpfs copy of the
  target, the Node permission model and time and memory limits. A test is
  accepted only when it fails on the bug build on its named assertion, passes
  on the fixed build and repeats that result without another model call.

- Integration slice S4i. `bin/foley.mjs` adds `run`, `backlog`, `eval`,
  `spend` and `baseline`, with exit codes 0 (success or verified proof),
  1 (no verified proof, or backlog interrupted), 2 (refused before any model
  call) and 3 (error). `src/run.mjs` runs watch, locate, repro, prove and
  report into one run folder, attributes every Ember call to its stage in
  `out/stage-spend.jsonl`, records per-call tokens and cost in `run.json`,
  writes the static replay page and `core-proof.json` with its artifact trace,
  and serves the live page with `--live`. Command-line paths must stay inside
  the working directory; census media are used only from the local media
  folder when their digest matches the census.
- Watch accepts QuickTime (`.mov`) recordings; 13 eligible census issues use
  that format.
- `tools/demo-offline.mjs` (`npm run demo:offline`) runs one full offline
  pipeline against the local fake model server into `out/demo-offline/`.
- Run data for the replay (S4x). Each reproduction turn may carry a
  one-sentence `observation` (at most 1,024 characters) and a `reason` per
  action (at most 512). The whole turn is checked before any action runs; a
  non-string, over-limit or credential-shaped explanation stops the run as
  `malformed_output` and the text is never stored. Executed action events in
  `replay.json` and `run.json` keep the turn's observation and the action's
  reason. The reproduction output ceiling is now 4,096 tokens, priced by the
  existing bound. The backlog writes `census.json` (`{issue, status}` for every
  candidate, in census order) to each started run folder after every stage, by
  file replacement, so the report sees the current outcome.
- Replay steps show the recorded model observation, action reason, and attributed
  usage alongside the selected frame. The issue census lists every recorded
  status and links to sibling replay files available at export.

### Fixed (wave-3 review, run integrity)

- `foley run` and `foley backlog` hold a kernel `flock` on `out/foley-run.lock`
  for the whole pipeline; a concurrent command refuses with `run_active`, and a
  killed owner's lock is released by the kernel (W3-01).
- Both commands drive each issue through one stage journal,
  `out/runs/<issue>/state.json`: start and commit records, at most two attempts
  per stage, resume only from the journal. A stage that throws is not committed,
  so a failed report never becomes a verified proof (W3-02, W3-08).
- Each Ember call record carries its case and stage, written in the same ledger
  transaction. Run, backlog and per-stage spend, including booked amounts, are
  rebuilt from those records and survive interruption (W3-03).
- `completion.json` is written last, after the report, final run document,
  static page, an exact artifact trace and a passing core-proof check; an
  interrupted export is repeated without model calls (W3-08).
- `checkCoreProof` requires the complete artifact inventory, an exact trace,
  matching run identity, an observed predicate and verified rerun results
  (W3-09).
- Live mode publishes the run document after every repro capture (W3-13).
- Census rows are published before an issue's first request and its terminal
  status before export (W3-14).
- Recordings and cached census media are checked for type, size, duration and
  content before any copy or full read, and hashed as a stream; an audio decode
  failure is a typed `refused_input` (W3-15).
- Preflight refuses targets with tracked changes; a resume with a different
  recording, revision, runner or fixture mode refuses with `resume_mismatch`;
  `backlog` accepts `--fixture` (W3-16).
- Wave-3 review repair, group L (W3-10, W3-11, W3-12, W3-19, W3-20). BRAN graph
  query hits now resolve to repository paths, so a BRAN match breaks anchor
  ties; the crate's JSON reader follows the JSON number grammar exactly.
  `foley eval` scores exactly the frozen held-out issues: absent issues are
  explicit rows, tuning rows never count, and new attempts use held-out census
  rows only. `eval` (`--budget-usd`, $1.50) and `backlog` (`--budget-usd`,
  $3.80; `--per-issue-usd`, $0.40) refuse over-ceiling budgets before any
  request and cap each issue's case budget by what the envelope has left in the
  ledger. The Node minimum is 22.13.0 (stable `--permission`) in `package.json`,
  the lockfile and preflight. `tools/check-public.mjs` reports
  `assignment-metadata` in return files, and three returns were cleaned.
- Wave-3 review repair, proof quality (W3-04 to W3-07, W3-17, W3-18).
  `prove` runs the target's own Vitest as well as node-test, through
  `tools/isolate.sh`: a pivot into a minimal read-only root with the candidate
  layered over a read-only overlay of each build, no network, no capabilities,
  an empty environment and time and memory limits. A proof is verified only
  when a failing assertion on the bug build reports the predicate's observed
  and expected values, the fixed build passes, and both builds' own pages,
  driven by the recorded steps, show the observed value and the expected value.
  Otherwise the result is `inconclusive` or a named rejection; model labels and
  code text are never evidence. Predicates are discriminated into
  `visible_text`, `element_count`, `console_error` and `canvas_state`, each
  checked from page data only; a null or invalid predicate stops before any
  paid call. Reproduction turns are validated whole before any action. Watch
  keeps bounded, timestamped `uncertainty` and `narration_evidence` through the
  run, comment and replay. One credential-shape predicate
  (`src/text-safety.mjs`) serves the input and display boundaries.

Pull request: [#3](https://github.com/1wgrumph/foley/pull/3)
