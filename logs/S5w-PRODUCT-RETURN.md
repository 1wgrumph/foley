# S5w product return: pointer actions and pair runs

Author: the S5w Implementer. Date: 2026-11-25. Branch `wave-4`. Not pushed. No
live model call was made; every model reply was scripted through the offline
fake server.

## Outcome: PASS

All 13 ids in `test/s5w/ids.txt` pass on the final head, and the green receipt
against `logs/S5w-red.receipt.json` passes. I edited no test. No earlier suite
regresses. The three real pairs reach `proof_verified` through
`foley run --pair` offline, three runs each.

## Changed paths

| Commit | Paths | Change |
| --- | --- | --- |
| 12f1a6d | `src/run-schema.mjs`, `src/repro.mjs`, `src/watch.mjs` | Pointer actions |
| ae0c8c8 | `src/locate.mjs` | Anchors only in files tracked at the pinned revision |
| 4c13ad5 | `src/run.mjs`, `src/run-schema.mjs`, `src/prove.mjs`, `bin/foley.mjs` | `foley run --pair` |
| fc537fe | `src/run.mjs` | 1024 MiB default test heap for pairs |
| 1918011 | `src/run.mjs` | `pairSide` extracted (no behaviour change) |
| 6cdc37d | `README.md`, `docs/SAFETY.md`, `docs/ARCHITECTURE.md`, `changelog.d/wave-4.md` | Documentation and changelog |

`src/locate.mjs` is outside the packet's guide list. The change was needed:
pair checkouts hold untracked built pages, and locate failed the run when BRAN
anchored one of them.

## What changed

**Pointer actions.** `pointer_click`, `pointer_double_click` and
`pointer_move` take `x` and `y`; `pointer_drag` also takes `to_x` and `to_y`.
- Coordinates are integers inside the fixed 1280 by 720 viewport. Device scale
  factor 1 is now explicit, so screenshots are 1280 by 720.
- `validPointer` in `src/run-schema.mjs` is the one bounds check. Model turns
  and recorded steps both use it.
- A turn with any bad coordinate is refused whole as `malformed_output` before
  any action runs.
- The element under a clicked point gets the same link and download block as a
  selector target.
- The reproduction prompt states the viewport, says coordinates refer to the
  screenshot the model was given, and says to prefer a selector when the
  element has one. The Watch prompt describes the same actions and keeps their
  fields.
- Price bound: each observe screenshot is 1280 px wide, within the governor's
  1600-tokens-per-frame rule for frames up to 1280 px.

**Pair runs.** `foley run --pair <issue> --recording FILE --case-budget N`:
- It reads the issue URL, commits, runner and `memory_mib` from
  `fixtures/pairs/pairs.json`, and the builds from
  `out/pairs/<issue>/receipt.json`.
- Before any model call, it refuses with `pair_missing`, `pair_build_missing`,
  `pair_commit_mismatch`, `pair_invalid` or `media_digest`. It also refuses
  (`bad_argument`) any of `--issue-url`, `--target`, `--revision`,
  `--fixed-target`, `--app-origin` or `--runner`, since the pair fixes them.
- Paths must stay inside the pair folder after symlinks, and each built page
  must be inside its own checkout. Commits and digests are checked by pattern,
  and the URL must be `https:`. Nothing is fetched, built or passed to a shell.
- The bug build is served on an ephemeral loopback port. Both pages go to the
  proof control.
- `pair: {issue, bug_commit, fix_commit}` joins the journal identity, the run
  document and the core-proof manifest. `checkCoreProof` refuses a manifest
  whose pair differs from the run's. A pair run and a census run on the same
  issue refuse to resume each other.

## Commands and exit codes

| Command | Exit | Result |
| --- | --- | --- |
| `FOLEY_PAIRS_DIR=$PWD/out/pairs FOLEY_OFFLINE=1 node --test --test-concurrency=1 test/s5w/*.test.mjs` | 0 | 13 tests, 13 pass |
| `node tools/red-receipt.mjs --green out/s5w/green-final.log --same-ids logs/S5w-red.receipt.json` | 0 | "green receipt: all 13 red ids pass" |
| `FOLEY_OFFLINE=1 node --test test/s5w/*.test.mjs` (packet gate, no pairs dir) | 0 | 12 pass, 1 skipped (the opt-in real pair) |
| The same, five runs in a row / two concurrent copies | 0 ×5 / 0, 0 | 12 pass each |
| `foley run --pair 10840`, `9852`, `8418`, three runs each plus one on the final head | 0 | `proof_verified`; all five stages ok; core proof carries the pair binding |
| `FOLEY_OFFLINE=1 node --test test/ember/` | 0 | 50 pass |
| `FOLEY_OFFLINE=1 node --test --test-concurrency=1 test/stages/` | 0 | 22 pass |
| `node --test test/ui/` | 0 | 4 pass |
| `FOLEY_OFFLINE=1 node --test test/e2e/` | 0 | 2 pass |
| `FOLEY_OFFLINE=1 node --test test/s4x/*.test.mjs` | 0 | 6 pass |
| `FOLEY_EXCALIDRAW_TARGET=<pinned target checkout> FOLEY_OFFLINE=1 node --test --test-concurrency=1 test/w3r/*.test.mjs` | 0 | 40 pass |
| `node test/pairs/check.mjs <issue> bug` / `fixed`, for each pair | 1 / 0 | All three |
| `node test/pairs/prove-pair.mjs <issue>`, for each pair | 0 | `verified` |
| `npm run demo:offline` | 0 | |
| `node tools/check-public.mjs --tree .` | 0 | 459 files, 0 findings |
| `az-lint --changed main` | 0 | |
| `az-simplicity --changed main --format json` (advisory) | 0 | `checked_paths` covers all seven of my product files; 0 findings in them (4 elsewhere) |

The pair runs used a scratch driver, `out/s5w/pair-run.mjs` (Git-ignored, not
committed). For each run it does the following:
1. Removes `out/runs/<issue>/`.
2. Starts the offline fake server with three scripted replies: Watch steps
   from the pair's `steps` and `predicate`, reproduction actions, and the
   pair's regression test as the proof candidate.
3. Runs this command:

```sh
node --import ./fixtures/stages/loopback-only.mjs bin/foley.mjs run \
  --pair <issue> --recording out/s5w/<issue>.mp4 --case-budget 400000
```

`out/s5w/<issue>.mp4` is a copy of `out/pairs/media/<issue>.bin`; the recording
check needs a video extension.

## Live pair run (operator)

1. Build the pair: `tools/build-pair.sh <issue>`. Its receipt must say
   `scan_verdict: PASS`.
2. Put the reporter's recording at `media/cache/<sha256>.mp4`. Its SHA-256
   must equal `recording.sha256` in `fixtures/pairs/pairs.json`.
3. In the shell, set `MODEL_API_KEY`, and unset `FOLEY_OFFLINE`,
   `FOLEY_EMBER_BASE_URL` and `FOLEY_TEST_API_KEY`.
4. Record the spend baseline once: `node bin/foley.mjs baseline <micro-usd>`.
5. Run the pair, then print the spend summary:

```sh
node bin/foley.mjs run --pair <issue> --recording media/cache/<sha256>.mp4 \
  --case-budget 400000 --live
node bin/foley.mjs spend
```

These commands make paid model calls; this slice did not run them.

## States that span entry points

| State | Owner and rule |
| --- | --- |
| `out/runs/<issue>/` writes | The run that holds the kernel flock on `out/foley-run.lock` (`lockRun`) owns every write. `run`, `run --pair` and `backlog` take the same lock, so two runs never write at once. |
| Which run a folder belongs to | The stage journal's identity (`identityOf`). A pair run carries `pair`, and a census run does not, so a pair run and a census run on the same issue refuse to resume each other (`resume_mismatch`). |
| Work complete | `completion.json`, written last by `finish`, after `checkCoreProof` agrees with the verdict. A complete issue is returned unchanged. |
| Served bug page | `run --pair` starts it after taking the lock and closes it in `finally` and in the SIGINT/SIGTERM handler. Each run gets its own ephemeral port. |
| Page control | `prove` serves each built page read-only per check and closes it before returning. |
| Pair builds `out/pairs/<issue>/` | Written only by `tools/build-pair.sh`. `run --pair` only reads them and checks commit and cleanliness at start. |

## Crash, retry and partial failure

| State | Handling |
| --- | --- |
| Crash during a pair run | The lock is released by the kernel. The journal resumes under the same identity: finished stages are not repeated and booked spend stays booked. The loopback server dies with the process. |
| Pair build changes between runs | Commit and tracked-clean checks run at every start. A different HEAD gives `pair_commit_mismatch`, and a tracked change gives `target_not_pinned`. |
| Receipt rewritten mid-run | It is read once at start. The prove stage uses the checkouts and pages resolved then. |
| Bad coordinates from the model | The whole turn is refused (`malformed_output`). No partial action runs. |
| Bad coordinates in recorded steps | `validateSteps` and `validateRun` reject them. The replay driver also drops any pointer action that fails `validPointer`. |
| A Vitest out-of-memory abort in proof | Seen at 256 MiB on the fixed build. Pairs now default to 1024 MiB, and 8418 records 2048. |

## Tests I believe are wrong

None.

## Amendments

- 2026-11-25: Pair runs default to a 1024 MiB test heap when `memory_mib` is
  absent. At prove's 256 MiB default, the 10840 fixed-build rerun aborted out
  of memory (exit 6), ending `rerun_mismatch`.
- 2026-11-25: Locate leaves out anchors in files not tracked at the pinned
  revision (`src/locate.mjs`, outside the guide list), because pair checkouts
  contain their untracked built page.
- 2026-11-25: In pair mode, `--issue-url`, `--target`, `--revision`,
  `--fixed-target`, `--app-origin` and `--runner` are refused rather than
  ignored.

## Remaining risks

1. **The scripted reproduction is not a model.** The pair runs show the
   pipeline and the trust boundaries. A real model must still choose good
   coordinates from 1280 by 720 screenshots.
2. **The Watch prompt asks the model to rescale coordinates.** It asks the
   model to scale a recording frame's coordinates to the viewport. That is
   untested against real recordings.
3. **The last 8418 rebuild timed out.** It hit the 900 s cap in its ESLint
   checker after the bundle was written. The bundle on disk comes from that
   run (same commit), and every 8418 check, proof and pair run passes on it.
   The receipt is from the first build.
4. **The CLI pair runs have no committed test.** They used an ignored scratch
   driver; the committed coverage is `TC-R15-4/pair-real-9852`.

## Blocker

None.
