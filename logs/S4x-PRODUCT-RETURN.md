# S4x product return: run data (reproduction, run, backlog)

Outcome: **PASS**. Product head `ce999c2` on `wave-3` (this return is
committed after it). Logs are local under `out/s4x-product/`, which Git
ignores.

## Changed paths

| Path | Change |
| --- | --- |
| `src/repro.mjs` | The prompt asks for `observation` (at most 1,024 characters) and a per-action `reason` (at most 512). The whole turn is validated before any action runs: a non-string, over-limit or credential-shaped value records `{type: "stopped", reason: "malformed_output"}` and stops the run, without storing the text. Executed `action` events carry the turn's `observation` and the action's `reason` only when supplied. The default output ceiling rises from 2,000 to 4,096 tokens; `callEmber` prices the reservation from that ceiling. |
| `src/backlog.mjs` | `census.json` (`{issue, status}` per candidate, in census order) is written to every started run folder after each completed stage, by temporary file and rename. After prove, the current issue's row shows the outcome that report will record. |
| `src/run-schema.mjs` | `validateRun` bounds `observation` (1,024) and `reason` (512) on `action` events. Other event types are unchanged. |
| `changelog.d/wave-3.md` | Appended the S4x run-data entry |

`src/run.mjs` needed no change: `run.json` copies replay events whole, so
the new fields carry through repro, prove and report.

## Commands

| Command | Exit | Result |
| --- | --- | --- |
| `FOLEY_OFFLINE=1 node --test test/s4x/*.test.mjs` | 0 | 6/6 pass (TC-R06-1, -3, -5/observation and TC-R09-1/census-record are this half's; both TC-R14-1 ids belong to the UI half) |
| `node tools/red-receipt.mjs --green out/s4x-product/s4x-files.log --same-ids <copy of logs/S4x-red.receipt.json>` | 0 | all 6 red ids pass |
| `FOLEY_OFFLINE=1 node --test test/s4x/` (the packet's form) | 1 | Node 22 treats the directory as one module and finds no index file, so no test case runs. The test return uses the file glob above. |
| `FOLEY_OFFLINE=1 node --test test/ember/` | 0 | 50/50 |
| Group a: `FOLEY_OFFLINE=1 node --test test/stages/watch test/stages/report test/stages/backlog test/stages/score test/stages/schema` | 0 | 11/11 |
| Group c: `node --test test/stages/repro test/stages/predicate test/stages/prove --test-concurrency=1 && node tools/repeat.mjs 5 test/stages/repro && node tools/concurrent2.mjs test/stages/repro` | 0 | 9/9; repeat 5/5; concurrent 2/2 |
| `FOLEY_OFFLINE=1 node --test test/e2e/` | 0 | 2/2 |
| `npm run demo:offline` | 0 | run and spend exit 0; replay page 0 extra requests, 0 console errors |
| `node tools/repeat.mjs 5 test/s4x/observation.test.mjs test/s4x/census.test.mjs` | 0 | 5/5 |
| `node tools/concurrent2.mjs test/s4x/observation.test.mjs test/s4x/census.test.mjs` | 0 | 2/2 |
| After the final backlog refactor: census repeat 5 and concurrent 2; group a, e2e, demo and s4x rerun | 0 | all pass |
| `node tools/check-public.mjs --tree .` | 0 | 405 files, 0 findings |
| `az-lint --changed main` | 0 | shellcheck, shfmt, biome, gitleaks pass; semgrep 0 findings |
| `az-simplicity --changed main --format json` | 0 | 0 findings in this half's files (41 elsewhere) |

## Acceptance to evidence

| Item | Evidence |
| --- | --- |
| 1. Observation and census-record ids pass | s4x run 6/6 with the green receipt |
| 2. Earlier suites still exit 0 | ember, group a, group c, e2e and demo rows above |
| 3. Explanation text is data | TC-R06-3/observation: number, null, over-bound and credential-shaped values for both fields stop as `malformed_output` before any action, and no artifact holds the sentinel. TC-R06-5/observation: the integrated run refuses, ends `attempted_miss` and stores no sentinel under `out/`. The text is never evaluated, and `validateRun` bounds it. Rendering as text is the UI half's job (TC-R14-1/observation). |

## Failure states

| State | Handling |
| --- | --- |
| Crash while census is written | The old `census.json` stays whole (temporary file, then rename); an open reader keeps the old bytes (TC-R09-1) |
| Crash between state save and census publish | Resume reruns from the persisted state. The census is refreshed after the next completed stage of any issue. Gap: a crash after an issue's last save, with no further issue to run, leaves the earlier census until the next backlog run that starts a stage. |
| Resume | Rows are rebuilt from the census and persisted states, so no duplicates appear and no completed issue repeats (TC-R09-1: 3 model requests) |
| Longer replies and spend | `callEmber` reserves each turn from the 4,096-token ceiling before sending. The existing case-budget refusal still stops the run (TC-R06-5) |
| Malformed turn | No action of that turn runs; the run stops with the existing stopped-event convention |

## Tests believed wrong

None. The packet's gate command `node --test test/s4x/` cannot run in
Node 22 (see Commands). I used the file glob that the test return names.

## Remaining risks

- Detecting credential shapes uses a fixed pattern list, mirrored from
  `tools/check-public.mjs`. A secret in an unlisted format would pass as
  ordinary text. The configured model keys are still refused by
  `src/ember.mjs`.
- The model's `verdict` string in `model_call` events is unchanged and has
  no bound. It is outside this contract.
- The TC-R14-1 ids passed against the UI half's uncommitted `ui/` files.
  The UI half reports them on its own head.

## Blocker

None.
