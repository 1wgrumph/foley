# S7 return: final documentation with live results

Outcome: **PASS**.

- Date: 2026-11-25. Observer for all checks: the S7 Implementer.
- Base `6742497`. Documents commit `7c7fd27`; this return is committed on top.
- No product, test or fixture file changed. No model call and no request to
  `api.meta.ai`. No held-out issue page or recording was opened.

## Changed paths

| Path | Change |
| --- | --- |
| `README.md` | First screen: one sentence, the 9852 result table, how Ember is used, the native computer-use measurement, replay page and trace. Then Results (pairs, repeatability, held-out both runs, census, spend, measured Ember facts, computer use), Limits and disclosure, Reproduce. Earlier sections kept and updated |
| `docs/SUBMISSION.md` | Rewritten: submission text, three-minute demo script, rubric and event rules mapped to evidence |
| `docs/ARCHITECTURE.md` | `callEmberComputer` and the bounds file; `regression.red.txt` and `fixed-check/` in the run folder; `failing_test_no_control` in the status set |
| `docs/SAFETY.md` | Video reservation at the 2,000 tokens per second ceiling; the audio and video refusal row corrected (video is now accepted and bounded) |
| `docs/evidence/` (new) | `README.md` and eight small copies or extracts of `out/` result files |
| `CHANGELOG.md`, `changelog.d/wave-4.md` | Entries naming the change, with the literal text `PR #4` |
| `logs/S7-RETURN.md` | This file |

## Checks

| Command | Exit | Result |
| --- | --- | --- |
| `grep -rn "RESULT PENDING" README.md docs CHANGELOG.md` | 1 | No match |
| `node tools/check-public.mjs --tree .` | 0 | 479 files, 0 findings |
| `gitleaks detect --no-banner --redact` | 0 | |
| `az-lint --changed main` | 0 | |
| Relative link and anchor check of every changed Markdown file (script) | 0 | 34 links, 0 broken |

## Commands shown in the README, run from a fresh clone of `6742497`

| Command | Exit | Result |
| --- | --- | --- |
| `npm ci`; `npx playwright install chromium`; `npm run build:ui` | 0; 0; 0 | |
| `npm run demo:offline` | 0 | Output ends exactly as the README shows |
| `(cd out/demo-offline && node ../../bin/foley.mjs spend)` | 0 | `{"baseline":0,"settled":33,...}` |
| `tools/build-pair.sh 9852` | 0 | 87 s; both commits built |
| `mkdir -p media/cache`; `curl -fsSL <9852 recording URL> -o media/cache/<sha256>.mp4` | 0; 0 | |
| `echo "<sha256>  media/cache/<sha256>.mp4" \| sha256sum -c -` | 0 | `OK` |
| `node bin/foley.mjs run --pair 9852 ... --dry-run` before `baseline` | 2 | `baseline_unset`. The README now records the baseline first |
| `node bin/foley.mjs baseline 0` | 0 | |
| `node bin/foley.mjs run --pair 9852 --recording media/cache/<sha256>.mp4 --case-budget 400000 --dry-run` | 0 | `dry run: issue 9852 ready; no model call made` |
| `node bin/foley.mjs spend` (fresh clone) | 0 | zero total |
| `node bin/foley.mjs spend` (project ledger, worktree) | 0 | the total shown in the README |
| `git diff --exit-code baseline-bran-v0.4.0 -- vendor/bran` | 0 | No output |
| `node bin/foley.mjs help` | 0 | |
| README "Tests" block: ember, e2e, stages a, stages c, ui, cargo, check-public | 0 each | 50; 2; 11; 15; 4; 2 passed; 0 findings |
| Live `run --pair` without `--dry-run` | not run | Needs a live key; marked in the README |

The scratch clone and the downloaded recording were removed afterwards.

## Number to source

| README number | Source |
| --- | --- |
| Recording 23.4 s | `ffprobe` on `out/demo/9852/recording.mp4`: 23.366 s |
| Bug `4ce70b8`, fix `cce5001`; rerun bug exit 1, fixed exit 0 | `docs/evidence/9852-core-proof.json` |
| `expected 'eraser' to be 'line'` | `out/demo/9852/proof.json`, bug output |
| Wall 66 s; pipeline 65 s | `docs/evidence/9852-repeats.txt` run 18; `out/demo/9852/run.json` `elapsed_ms` 64,618 |
| $0.005059, 3 calls | `9852-repeats.txt` run 18 (ledger difference); last three `model_calls` in `out/demo/9852/run.json` (1,954 + 857 + 2,248) |
| Watch 86 prompt tokens; normally about 28,700 | `out/demo/9852/run.json` `model_calls` (Watch inputs 28,181 to 29,181 elsewhere) |
| 5 of 5 at `17791cf`, 3 of 5 at `00e38f7`; cost and wall ranges | `docs/evidence/9852-repeats.txt` |
| Video one fifth of frame tokens; 6 of 8 against 8 of 8 | `fixtures/ember/bounds.json` (4,206 against 20,520; `watch_note`) |
| Native computer use $0.000373, 9.0 s, 2 calls; loop $0.000631, 4.6 s, 1 call; safety stop $0.000455 | `out/pilot/cu.json`, `out/pilot/loop.json`; `logs/S3b-RETURN.md` |
| Replay page cost $0.257391 | `out/demo/9852/run.json` `cost_micro_usd` 257,391 |
| Trace 7 calls, 14,280 / 23,478 tokens, $0.013285 | `trace/9852/summary.json` |
| Pairs: runs 19, 11, 5; 9852 first verified on run 9 | `docs/evidence/pairs-runs-summary.json`; `out/core-*-run*.log` |
| Pair spend $0.125794, $0.192960, $0.039742; causes | `logs/S5-RETURN.md` |
| Held-out run 1: 1 of 8, 9812, top-1 and top-5 0, $0.017187, 715 s | `docs/evidence/heldout-run1-report.json` |
| Held-out run 2: 2 of 8, 9812 and 9710, 0 and 0, 1,677 s | `docs/evidence/heldout-run2-report.json` |
| Held-out run 2 $0.034280 per issue | `logs/S6b-RETURN.md` ledger difference 274,241 / 8 |
| 6 of 7 first-run misses stopped on leading prose; fix `969faa0` | `logs/S6-RETURN.md`; held-out run 1 report results |
| Census 11 / 25 / 12 / 2, first run 5 / 31 / 12 / 2 | `docs/evidence/census-summary.json` |
| Census proofs: 10 `wrong_predicate`, 1 `test_error`; 25 misses "failure not shown" | `docs/evidence/census-rows.json` |
| 29 rejected red-test rounds: 20 passed on bug build, 9 unrelated values | `logs/S6b-RETURN.md` (not in committed data) |
| Census date 2026-11-24, commit `eaa7fa3` | `fixtures/census/census.json` |
| Total $2.576656 | `node bin/foley.mjs spend`; `docs/evidence/spend-summary.json` |
| Spend items: probe 13,761; pilot 2,184; pairs 362,455; repeats 104,590 + 32,430; held-out 137,494 + 274,241; census 683,791 + 965,710 (micro-USD) | `logs/S3-RETURN.md`, `S3b`, `S5`, `S6`, `S6b` ledger totals; the items add up to 2,576,656 |
| Probe tokens, prices, `max_completion_tokens`, 3,998 of 4,000 reasoning, audio 196 tokens and 10 s tone, 23 against 4,619 tokens | `fixtures/ember/bounds.json`, `out/probe/*.json`, `logs/S3-RETURN.md`, `test/probe.live.mjs` |
| `build-pair.sh` 87 s | this slice's fresh-clone run |

## Data against returns

1. The packet asks to state that nine runs came before the first verified
   run. The run data shows that 9852 first verified on run 9, after eight
   missed runs (`docs/evidence/pairs-runs-summary.json`). The README says
   eight.
2. The held-out second-run report gives a cost per attempt of 51,466.875
   micro-USD. That figure adds each issue's first-run spend (for example
   11223: 30,506 + 33,043 = 63,549). The ledger difference for the second run
   alone is 274,241, or 34,280 per issue. The README uses the ledger figure
   and names the report's.
3. `logs/S5-RETURN.md` lists per-pair spend that adds up to 358,496 micro-USD.
   The ledger difference over S5 is 362,455. The 3,959 difference is not
   attributed in the return.
4. `logs/S6b-RETURN.md` gives 66 s for run 18. That is wall time including
   start-up. `run.json` `elapsed_ms` is 64,618. The README shows both.
5. `trace/9852/` records run 12, but the demo folder is run 18, which S6b
   chose to replace it. The README and SUBMISSION say so.
6. `logs/S3-RETURN.md` calls the audio a 12 s WAV, and `bounds.json` calls it
   a 10 s tone. `test/probe.live.mjs` makes 10 s of tone and 2 s of silence,
   so both hold.

## Remaining risks

- The 9852 replay page is not committed: it embeds the reporter's recording.
  Judges see it only in the demo video.
- The headline cost of $0.005059 is low partly because of the unexplained
  repeated-request usage figure. The README discloses this beside the number.
- The live pair run in "Reproduce" was not executed in this check.
- The demo video link does not exist yet. SUBMISSION gives the script, not
  a link.
- The 9852 test contains a fallback that sets the in-progress line through
  the test API. The README discloses it. A reviewer may judge that it weakens
  the test.

Blocker: none.
