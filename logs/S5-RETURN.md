# S5 return: live core proof

Author: the S5 Implementer. Date: 2026-11-25. Branch `wave-4`. Not pushed.

## Outcome: PASS

One real pair, issue 9852, reached `proof_verified` live with no human repair.
The run was:
1. Ember watched the reporter's recording.
2. Ember reproduced the failure on the bug build. The same steps did not show
   it on the fixed build.
3. Ember wrote a Vitest test. The test fails on the bug build and passes on
   the fixed build.
4. The saved test still separates the builds when rerun with an empty
   environment, with no key and no model.

`checkCoreProof` on the run folder returns `ok`.

Two pairs did not verify:
- 10840 used all 11 of its runs: the 3 first allowed plus the 8 the
  orchestrator authorized.
- 8418 used 5 runs; its cause is structural (see Misses).

The goal was at least one verified pair, aiming for three: one is verified.

Spend on the live ledger: $0.378400, under the $2.86 stop. Each pair stayed
under its 500,000 micro-USD ceiling:
- 9852: 125,794
- 10840: 192,960
- 8418: 39,742

## The verified run (9852)

| Item | Value |
| --- | --- |
| Command | `node bin/foley.mjs run --pair 9852 --recording media/cache/<sha256>.mp4 --case-budget 500000` (run 9) |
| Stages | watch ok, locate ok, repro reproduced, prove verified, report ok |
| Predicate (from Watch) | `appState.activeTool.type`: expected `line`, observed `eraser` |
| Reproducing actions | L, click, move, click, move, E: a multi-point line still in progress, then the eraser shortcut |
| Fixed-build check | the same actions on the fixed build do not show the failure |
| Proof | first round `verified`; prove's own rerun without Ember: bug exit 1, fixed exit 0 |
| Independent rerun | `env -i PATH=/usr/bin:/bin tools/isolate.sh vitest <node> out/pairs/9852/<side> out/core/rerun-9852/candidate 1024 170 regression.test.mjs`: bug exit 1 (`expected 'eraser' to be 'line'`), fixed exit 0 |
| Core proof | `out/core/core-proof.json`, a copy of `out/runs/9852/core-proof.json`; `checkCoreProof`: `{"status":"ok","fixture":false}` |
| Replay page | `out/runs/9852/replay.html`, rebuilt with `npm run build:ui` and `renderReplay` from the run folder. Opened offline: 0 requests besides the page, 0 console errors. It shows Ember's decision, the timeline, bug FAIL against fixed PASS, the test, and every model call (screenshot `out/core/replay-9852.png`) |
| Wall time | 73 s |

The test Ember wrote (`out/runs/9852/regression.test.mjs`) renders the editor,
presses L, clicks twice with a move between to keep a line in progress,
presses E, and expects the line tool to stay active.

## In-product mechanisms added (all bounded, metered and tested)

Each extra call goes through the ledger and appears in the replay page's action
feed. None uses a per-issue answer.

| Mechanism | Where | Test |
| --- | --- | --- |
| One Watch re-ask when a JSON reply fails step validation, with the broken rule | `src/watch.mjs` | TC-R04-1 (invalid then invalid: `malformed_output`, 2 requests; invalid then valid: ok); TC-R04-1/unsupported-watch-predicate |
| One reproduction re-ask when a JSON turn fails `validTurn`, with the broken rule. None of the invalid turn's actions run | `src/repro.mjs` | TC-R06-3/reask; TC-R06-3/whole-turn, TC-R06-3/observation, TC-R06-3/pointer-whole-turn (2 requests, 0 actions) |
| Re-asks never send back or keep credential-shaped model text | both | TC-R06-5/observation (no sentinel on disk) |
| A predicate that already holds on the fresh page is rejected (`predicate_holds_before`) | `src/repro.mjs` | TC-R06-1 |
| Up to 2 extra Watch rounds when reproduction does not show the failure, the predicate held before, or Watch gave none. Watch hears what reproduction did and what the page showed (`predicate_value_after`) | `src/run.mjs` | TC-R06-7/watch-round |
| A readable predicate is kept across rounds; only the steps change | `src/run.mjs` | TC-R06-7/watch-round-keeps-predicate |
| Pair runs replay the reproducing actions on the fixed build without a model. If the fixed build shows the failure too, Watch gets another round | `src/run.mjs` | TC-R06-7/pair-fixed-build-check |
| The actions that reproduced the failure become the steps that proof and its page control replay | `src/repro.mjs`, `src/run.mjs` | TC-R06-1 (`reproduced_steps`) |
| Each turn carries `failure_check_now`, the page's current value for the failure's subject | `src/repro.mjs` | TC-R06-3/reask |
| Target app notes (`app_notes`), written once for the target from its help dialog, `actions/shortcuts.ts` and `locales/en.json` hints | `fixtures/pairs/pairs.json`, Watch and repro | TC-R04-6, TC-R06-3/reask |
| `wait` and `scroll` accept decimal text; retries reason at `medium`; the replay records each key sent and the head of a non-JSON reply | `src/repro.mjs` | TC-R06-3/reask, TC-R06-1/key-detail |

Plus the fixes from the first round (commit 25f47b1): issue title to Watch,
reproduction and proof; target test notes for proof; JSON mode; settle before
the check; prompt rules for pointer fields, selectors and state keys.

Disclosure: `test_notes` and `app_notes` in `fixtures/pairs/pairs.json` were
written once for the target by the Implementer, from Excalidraw's own test
helpers, help dialog and on-screen hints. They describe the target, not any
issue's answer. The app notes include the app's own hint "click to start
multiple points, drag for a single line". That hint is general, and it bears
on 9852.

## Runs after the orchestrator's decision

| Run | Change it tested | Result |
| --- | --- | --- |
| 9852 run 4 | settle fix, JSON mode, titles, Watch rounds, re-asks, reproduced steps | miss: Watch rounds settled on `selectedElementIds.length`, which is unreadable |
| 9852 run 5 | predicate value in feedback; `selectedElementIds` described | reproduced; proof `unconditional_failure`: drag-made lines finish at once, so the fixed build shows `eraser` too |
| 9852 run 6 | fixed-build check | miss: an invalid reproduction turn ended the run |
| 9852 run 7 | reproduction re-ask | miss: rounds kept drawing with drags, which the fixed-build check rejected |
| 9852 run 8 | app notes, retry effort, decimal waits | miss: Watch changed to an unreadable predicate |
| 9852 run 9 | readable predicate kept | **proof_verified** |
| 10840 runs 4 to 11 | the same changes in turn, then live check values, key detail, `medium` effort | all misses: reproduction never pressed Escape after the laser before leaving view mode, so the page ended on `laser` |
| 8418 runs 4 and 5 | all mechanisms | reproduced on the bug build, but the fixed build showed the same predicate; proof failed |

Two mechanisms were tried and taken out, and neither is committed:
- An in-attempt continue after a contradicted "reproduced" verdict. It
  conflicts with the accepted rule that each retry starts in a clean browser
  context (TC-R06-5).
- `medium` effort on the first reproduction attempt. It gave no gain on
  10840 run 11.

## Misses

1. **10840:** the failure needs Alt+R, K, Escape, Alt+R. Ember reproduces
   view mode and the laser but never presses Escape, across 24 attempts in 8
   runs. Watch cannot see key presses in the recording.
2. **8418:** the reporter says the button text should change. The fix instead
   turns the button green, adds a check icon and disables it; the label stays.
   No text predicate taken from the report can separate the builds. Separating
   them needs a DOM-level predicate, and nothing visible in the recording names
   one. The six authorized runs left were not spent.

## Commands and exit codes (final head)

| Command | Exit | Result |
| --- | --- | --- |
| `FOLEY_OFFLINE=1 node --test test/ember/` | 0 | 50 pass |
| `FOLEY_OFFLINE=1 node --test --test-concurrency=1 test/stages/` | 0 | 24 pass |
| `node --test test/ui/` | 0 | 4 pass |
| `FOLEY_OFFLINE=1 node --test test/e2e/` | 0 | 2 pass |
| `FOLEY_OFFLINE=1 node --test test/s4x/*.test.mjs` | 0 | 6 pass |
| `FOLEY_EXCALIDRAW_TARGET=<target> FOLEY_OFFLINE=1 node --test --test-concurrency=1 test/w3r/*.test.mjs` | 0 | 42 pass |
| `FOLEY_OFFLINE=1 node --test test/s5w/*.test.mjs` | 0 | 13 pass, 1 skipped |
| `npm run demo:offline` | 0 | |
| `node bin/foley.mjs spend` | 0 | total 378,400 micro-USD |
| `az-lint --changed main` | 0 | |
| `gitleaks detect --no-banner --redact` | 0 | |
| `node tools/check-public.mjs --tree .` | 0 | 0 findings |
| `az-simplicity --changed main --format json` (advisory) | 0 | 8 advisory findings in my files: cognitive complexity 21 to 23 in `prepareResponses`/`call` (`src/ember.mjs`), `prove`, `execute`, `watch` and `pairOptions`, and length over 50 lines in `ask` (`src/repro.mjs`) and `pairOptions`. Not changed in this slice; listed for a simplification pass. Friction: `checked_paths` came back empty although findings named these paths |

These tests were run against the previous product code: red there, green
after. TC-R04-6, TC-R07-1, TC-R01-1, TC-R06-1, TC-R06-7/watch-round,
TC-R06-7/pair-fixed-build-check. TC-R06-7/watch-round-keeps-predicate and
TC-R06-1/key-detail were not run red first. The settle fix used the unchanged scripted
check `out/core/settle-check.mjs` (exit 1 before, 0 after).

## Commits

25f47b1 (first-round fixes), cdf97de (interim return), 56d58a3 (bounded
retries), cf3f348 (fixed-build check and reproduction re-ask), 92901d2 (app
notes and kept predicates), 015abc8 (live check value and key detail), and the
commit that records this return.

## Remaining risks

1. One verified pair out of three. Reaching it took nine runs and several
   product changes; whether a fresh 9852 run verifies first time is
   unmeasured.
2. The target notes are human-written target context (disclosed above).
3. The usage anomaly on exactly repeated requests (a small `prompt_tokens`
   with `cached_tokens` 0) is unexplained; the owner's console shows billing.
4. The replay page's cost and model-call feed cover every run of the case,
   not only the verified run.

## Blocker

None.
