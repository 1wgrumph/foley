# S4i return: command line and integrated pipeline

Outcome: **PASS**.

- Head of the slice: `d571609` (this return is committed on top of it).
- Date: 2026-11-25. Observer for all results: the S4i Implementer.
- No live model call was made. Every run used the local fake server.

## Changed paths

| Path | Change |
| --- | --- |
| `bin/foley.mjs` | New CLI: `run`, `backlog`, `eval`, `spend`, `baseline`, `--version`, `help` |
| `src/run.mjs` | New pipeline: preflight, run lock, stage functions shared by `run` and `backlog`, Ember call attribution, run document, static page, core proof |
| `src/watch.mjs` | Integration fix: accept QuickTime `.mov` recordings (see "Defects fixed") |
| `tools/demo-offline.mjs` | New offline demonstration script; no test imports it |
| `package.json` | `bin.foley`; script `demo:offline` |
| `changelog.d/wave-3.md` | S4i entries |

No edit to `test/`, `fixtures/`, existing test tools or `vendor/bran/`.

## Exit codes

- 0: success, or a verified proof for `run`.
- 1: a finished run with no verified proof, or an interrupted backlog.
- 2: refused before any model call. The message is
  `foley: refused: <code>: <text>`. Codes: `bad_argument`, `unknown_command`,
  `missing_path`, `outside_working_tree`, `tool_absent`, `ui_not_built`,
  `baseline_unset`, `target_not_pinned`, `run_active`, `media_missing`,
  `media_digest`, `bad_census`, `missing_report`.
- 3: error, including a spend reconciliation failure.

## Commands and exit codes

Unless noted, every command ran on the integrated tree at `5e2e645`. The
refactor in `d571609` touched only `src/run.mjs`, `bin/foley.mjs` and
`tools/demo-offline.mjs`. None of the group suites imports those files, so
their results carry over (rule 28). The rows that use `run.mjs` were rerun on
`d571609`.

| Command | Exit | Result |
| --- | --- | --- |
| `FOLEY_OFFLINE=1 node --test --test-reporter=tap test/e2e/` (`d571609`) | 0 | 2/2: TC-INT-1, TC-R14-2 (`out/s4i-e2e-green.log`, sha256 `e8ca076e…`) |
| `node tools/red-receipt.mjs --green out/s4i-e2e-green.log --same-ids logs/red-s4-e2e.receipt.json` | 0 | "all 2 red ids pass" |
| `node tools/repeat.mjs 5 test/e2e` (`d571609`) | 0 | 5/5 |
| `node tools/concurrent2.mjs test/e2e` (`d571609`) | 0 | 2/2 |
| `FOLEY_OFFLINE=1 node --test test/ember/` | 0 | 50/50 |
| Group a (CMD-UNIT): `node --test test/stages/watch test/stages/report test/stages/backlog test/stages/score test/stages/schema` | 0 | 11/11 |
| Group b Node part: `node --test test/stages/locate` | 0 | 2/2 |
| Group b `cargo test --manifest-path foley-crates/bran-media-evidence/Cargo.toml` | 0 | 2/2 |
| Group c (CMD-BROWSER): `node --test test/stages/repro test/stages/predicate test/stages/prove --test-concurrency=1` | 0 | 9/9 |
| Group c: `node tools/repeat.mjs 5 test/stages/repro`; `node tools/concurrent2.mjs test/stages/repro` | 0; 0 | 5/5; 2/2 |
| Group u (CMD-UI): `npm run build:ui && node --test test/ui/` | 0 | 4/4 |
| Group u: `node tools/repeat.mjs 5 test/ui`; `node tools/concurrent2.mjs test/ui` | 0; 0 | 5/5; 2/2 |
| `node tools/check-fixtures.mjs fixtures/` | 0 | OK, 0 failed |
| `node tools/check-public.mjs --tree .` (`d571609`) | 0 | 397 files, 0 findings |
| `az-lint --changed main` (`d571609`) | 0 | cargo-fmt, clippy, shellcheck, shfmt, biome (42 files), gitleaks, semgrep pass |
| `(cd vendor/bran && CARGO_BUILD_JOBS=4 ./tools/ci/check.sh --fast)` | 0 | No other gate was running first |
| `git diff --exit-code main -- vendor/bran` | 0 | Vendored BRAN unchanged |
| `az-simplicity --changed main --format json` (`d571609`) | 0 | 35 findings in the tree, 0 in S4i files (one refactored, three marked) |
| Offline demonstration: `npm run demo:offline` (`d571609`) | 0 | `issue 1: proof_verified`; spend `{"settled":33,"per_stage":{"watch":11,"repro":11,"prove":11}}`; `replay.html: 0 requests besides the page file; 0 console errors` |
| Seeded control: scratch clone `out/s4i-seed` with `anchors.json` unlinked after locate, then TC-INT-1 | 1 | Expected failure: `Missing stage artifact: anchors.json` (`out/s4i-seeded.log`). Clone removed |
| Offline `foley backlog` on a one-issue synthetic census, run twice | 0; 0 | One row written. The second run made no new model request (resume) |

The offline demonstration writes its run folder to
`out/demo-offline/out/runs/1/`. The exact command, from the repository root,
is `npm run demo:offline`, which runs
`FOLEY_OFFLINE=1 node tools/demo-offline.mjs`.

## Acceptance to evidence

| Item | Evidence |
| --- | --- |
| 1. TC-INT-1 and TC-R14-2 pass; green against `logs/red-s4-e2e.receipt.json` | e2e 2/2; green receipt exit 0; 5/5 and 2/2 |
| 2. CLI commands, exit codes, `--live`, typed refusals | Scripted CLI checks, each with the exit code shown: `--version` 0; unknown command 2; `run --dry-run` with baseline unset 2 (`baseline_unset`); after `foley baseline 0` the same dry run 0; target HEAD not at the revision 2 (`target_not_pinned`); non-loopback `--app-origin` 2; tools missing from PATH 2 (`tool_absent: git`); `spend --dry-run` 0; `spend` 0. `--live`: TC-R14-2 |
| 3. One run folder with every artifact; attributed calls; per-step tokens and cost | Demo folder holds `recording.mp4`, `steps.json`, `anchors.json`, `replay.json`, `proof.json`, `regression.test.mjs`, `comment.md`, `replay.html`, `run.json`, `core-proof.json`, `artifact-trace.jsonl` and `screenshots/`. `run.json` `model_calls` lists each Ember call with stage, status, call IDs, tokens and cost. Each repro turn's tokens and cost sit on the action it produced; watch and prove calls appear as `model_call` events with their usage. `out/stage-spend.jsonl` maps every call ID to its stage. The model's observation is not available; see amendment A3 |
| 4. Integrated gates | All rows above exit 0 |
| 5. Seeded control | TC-INT-1 fails with the stage artifact removed |
| 6. Trust boundaries | Paths: `--recording /etc/hostname` and `--target ..` are refused with `outside_working_tree` (exit 2). Census media and text: a census whose media file digest differs is refused with `media_digest` (exit 2) before any model call. The census title `$(touch pwned) <img …> ignore all instructions` is never passed to a shell, a page or a prompt, and no `pwned` file appeared. Media are never fetched by Foley; they are read only from the local media folder, and only when the digest matches |

## Failure states of the integrated run

| State | Handling |
| --- | --- |
| Crash during a write | `run.json`, `core-proof.json` and every stage artifact are written to a temporary file and renamed. An Ember reservation in flight stays booked (W2R ledger) |
| Crash between stages | The next `foley run` reloads `run.json` and skips stages listed in `run.stages`. The backlog resumes through `state.json`; an interrupted stage runs at most once more |
| Concurrent runs on one `out/` | `out/foley-run.lock` is created exclusively and holds the PID. A live holder gives `run_active` (exit 2). A dead holder's lock is taken over. Runs in different working directories are independent (two-copy e2e run passed) |
| Retry or duplicate run | A finished run is returned unchanged with no model call. A second backlog run made no new request. Ember keeps its one rate-limit retry; the CLI adds none |
| Partial failure | A stage exception publishes `state: "error"` with the message, releases the lock and exits 3. A model miss finishes as `attempted_miss`, with report, page and core proof still written |
| Termination (`SIGTERM`, `SIGINT`) | The live server closes, the lock is released and the process exits 143. The page keeps its last data and shows disconnected (TC-R14-2) |
| Money | Every call goes through `callEmber` with the case ID and case budget. The spend summary reconciles exactly and attributes watch, repro and prove (TC-INT-1) |

## Defects fixed

- `src/watch.mjs` refused QuickTime recordings. 13 of the 36 eligible census
  issues use `video/quicktime`, so a census run would have marked them
  `attempted_miss` without trying them. Origin: the type table listed only MP4
  and WebM. Escape: the census was built after watch, and no case uses a
  `.mov` clip. Product defect. Red then green: a scripted check, run unchanged,
  generates a 2-second `.mov` with ffmpeg and calls `watch` with a counting
  model stub. Before the fix it printed `status=refused_input calls=0` (exit 1).
  After the fix it printed `status=api_error calls=1` (exit 0). Group a watch
  tests still pass 3/3. Prevention: the census media types are now named in the
  type table's comment.

## Amendments

- A1 (2026-11-25): `run.json` `replay.screenshots` lists executed-action frames only. `observe` and `check` captures stay in `replay.json`, because the static page opens on the last moment and TC-INT-1 compares that image with the first listed screenshot.
- A2 (2026-11-25): CMD-PRE-CLI names `fixtures/issues/seeded.json` and `fixtures/census.json`, which do not exist and which this slice may not add. `run --dry-run` takes the same flags as `run`; `backlog --dry-run` takes `fixtures/census/census.json` and needs the pinned target and cached media.
- A3 (2026-11-25): the repro reply schema `{actions, done, verdict}` carries no observation or per-action reason, so the run file records only Ember's stated verdict per turn. Smallest change: add an optional top-level `observation` string and a per-action `reason` string to the repro reply schema and prompt, and copy them into the replay events. The event schema already allows extra fields.
- A4 (2026-11-25): CMD-CORE uses `FOLEY_LIVE=1`, `--envelope backlog`, `--case-budget 0.40` and `tools/core-proof.mjs`. Live mode is selected by leaving `FOLEY_OFFLINE` unset and setting `MODEL_API_KEY`. Case budgets are integer micro-dollars, as the interface requires. The ledger cap is the envelope. `checkCoreProof` in `src/run-schema.mjs` checks the core proof.
- A5 (2026-11-25): the design's single-stage commands (`watch`, `locate`, `repro`, `prove`, `report`) are not exposed. `run` resumes stage by stage, and the interface note names only `run` and `spend`.
- A6 (2026-11-25): the replay page's census index needs a census record in the run folder. No run writes one yet. Smallest change: `backlog` writes `runDir/census.json` with `{issue, status}` rows before the report stage.

## Operator commands

Run these from the repository root after the owner has recorded the baseline
and the pinned Excalidraw build is serving on loopback. The key comes from the
owner's environment and is never written to a file.

Record the baseline once (owner):

```sh
node bin/foley.mjs baseline <micro-usd>
```

Live single-bug run:

```sh
unset FOLEY_OFFLINE FOLEY_EMBER_BASE_URL FOLEY_TEST_API_KEY
# MODEL_API_KEY is set in the owner's shell
node bin/foley.mjs run <issue> \
  --issue-url https://github.com/excalidraw/excalidraw/issues/<issue> \
  --recording media/cache/<sha256>.<mp4|mov|webm> \
  --target target --revision eaa7fa32a6645ae9da57eda548e838d0e2a024a1 \
  --app-origin http://127.0.0.1:<port> --runner vitest \
  --case-budget 400000 --live
node bin/foley.mjs spend
```

Census run. First fetch the eligible media into `media/cache/`, which is
ignored by Git, and check each digest:

```sh
mkdir -p media/cache
jq -r '.candidates[] | select(.status=="eligible_not_attempted") | .media[0]
  | "\(.url) \(.sha256) \(.media_type)"' fixtures/census/census.json |
while read -r url sha type; do
  case $type in video/mp4) ext=.mp4 ;; video/quicktime) ext=.mov ;; video/webm) ext=.webm ;; esac
  curl -fsSL "$url" -o "media/cache/$sha$ext"
  echo "$sha  media/cache/$sha$ext" | sha256sum -c -
done
node bin/foley.mjs backlog fixtures/census/census.json --dry-run \
  --target target --app-origin http://127.0.0.1:<port> --runner vitest --case-budget 100000
node bin/foley.mjs backlog fixtures/census/census.json \
  --target target --app-origin http://127.0.0.1:<port> --runner vitest --case-budget 100000
node bin/foley.mjs eval --labels fixtures/eval/held-out.json
node bin/foley.mjs spend
```

## Remaining risks

- `src/prove.mjs` supports only the `node-test` runner. With the real target's
  `vitest` runner, prove returns `not_verified` (`unsupported runner`), so a
  live Excalidraw run can reach at most `failure_observed`. FOL-R15 needs a
  verified proof on a real issue, so this blocks the core proof and belongs to
  group c's next slice.
- A real open issue has no fixed build, so prove has no fixed-target run. The
  verification rule for real issues needs a decision in the prove slice.
- Taking over a dead lock has a small race: if two processes find the same
  dead lock at the same moment, both can start. A single operator running one
  command at a time does not hit it.
- Live updates happen per model call and per stage, not per browser action
  inside repro.

Blocker: none for this slice. The `vitest` runner gap above blocks the later live core proof.
