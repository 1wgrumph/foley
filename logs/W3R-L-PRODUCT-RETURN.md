# W3 repair, group L (product): return

Author: the group L product Implementer. Date: 2026-11-25. Branch `wave-3`.
Review repair of findings W3-10, W3-11, W3-12, W3-19 and W3-20. Not pushed.

## Outcome: PASS

All 10 tests in `test/w3r/L.ids.txt` pass on the final head, and the green
receipt against `logs/W3R-L-red.receipt.json` passes. No earlier suite
regresses. I edited no test, fixture or test tool. No real network call was
made.

## Head and changed paths

The head is the commit that adds this return. Product commits:

| Commit | Change |
| --- | --- |
| 7ccc6f5 | W3-10 and W3-20: `foley-crates/bran-media-evidence/src/lib.rs` |
| 90a2339 | W3-11: new `src/eval.mjs`; `bin/foley.mjs` (`eval` command, budget options, shared census runner) |
| 0f3be95 | W3-19: `package.json`, `package-lock.json` (root `engines` only), `tools/preflight-tools.sh` |
| 14de507 | W3-12: `tools/check-public.mjs`; `logs/S2-RETURN.md`, `logs/S4a-RETURN.md`, `logs/W2R-PRODUCT-RETURN.md` |
| 7435570, e4093e1 | `tools/check-public.mjs`: per-line checks moved into `checkLine` (no behaviour change) |

Also `changelog.d/wave-3.md` (appended) and this return.

Another group's file: `bin/foley.mjs` holds group R's `run` and `backlog`
commands. My W3-11 commit changed `backlog` only where the envelope requires
it: budget options, and the census run moved into `processCensus`, which `eval`
also calls. The `run` command is unchanged.

## Findings

| Finding | Root cause | Fix commit | Proving test | Prevention |
| --- | --- | --- | --- | --- |
| W3-10 | `graph.find` returns node ids (content hashes), which never equal an anchor path, so BRAN evidence could not change rank. | 7ccc6f5 | TC-R05-1/graph-tie | Each hit resolves to a path: a file node through its scanner locator, a symbol or test node through the file on its incoming edge. Scratch check: on the same two-file repository the old binary ranks `a.mjs` first and the new one ranks `b/Archive.mjs` first. |
| W3-11 | `eval` scored every row of the backlog report: no held-out selection, absent cases dropped, tuning rows counted, and no aggregate budget cap. | 90a2339 | TC-R10-1/eval-population, TC-R10-2/eval-split, TC-R10-3/eval-execution, TC-R10-3/envelope-ledger, TC-R10-3/envelope-ceilings | `heldOutIds` accepts only the frozen held-out list, disjoint from tuning, else `bad_labels`. `evaluate` emits one row per held-out issue in held-out order. Budgets are checked before anything else, including dry runs. `envelope` sets each issue's case budget to `min(per-issue, own spend + envelope left)`, read from `out/ledger.json` just before the issue starts. |
| W3-12 | Three committed returns named the assigned tool, model and worktree, and `check-public` had no class for that. | 14de507 | TC-R11-1/return-metadata; self-test fixture `fixtures/public-negative/assignment-metadata` | The new `assignment-metadata` class flags harness, model, worktree, route or session field lines, and role lines naming an "x / y" route, in any `*RETURN*.md`. The tree check is clean (424 files, 0 findings). |
| W3-19 | `engines` said `>=20`, but the locked `@axe-core/playwright` needs 22.12.0 and `tools/isolate.sh` uses `--permission`, which is stable only from Node 22.13.0 (Node changelog, 22.13.0 notable changes: "Stabilize Permission Model", #56201). | 0f3be95 | TC-R13-1/node-minimum, TC-R13-1/node-preflight | `engines` and the lockfile root say `>=22.13.0`. Preflight adds `node <v> is older than the supported minimum 22.13.0` to its failure list and exits 1. |
| W3-20 | Numbers were parsed with Rust `f64::from_str`, which accepts forms outside JSON (`01`, `1.`, `.5`, `+1`). | 7ccc6f5 | TC-R05-1/json-number-grammar; crate unit test with 11 malformed forms | A hand-written parser follows the JSON number grammar exactly: `-?(0\|[1-9][0-9]*)(\.[0-9]+)?([eE][+-]?[0-9]+)?`. |

## Commands and exit codes

| Command | Exit | Result |
| --- | --- | --- |
| `FOLEY_OFFLINE=1 node --test test/w3r/L.test.mjs` | 0 | 10 pass, 0 fail |
| `node tools/red-receipt.mjs --green out/w3r-l/green-final.log --same-ids logs/W3R-L-red.receipt.json` | 0 | "green receipt: all 10 red ids pass" |
| Group L tests, five runs in a row / two concurrent copies | 0 ×5 / 0, 0 | 10/10 each |
| `FOLEY_OFFLINE=1 node --test test/ember/` | 0 | 50 pass |
| Group a (CMD-UNIT) | 0 | 11 pass |
| Group b: `(cd vendor/bran && ./tools/ci/check.sh --fast)`; crate `cargo test`; `node --test test/stages/locate`; `git diff --exit-code -- vendor/bran` | 0, 0, 0, 0 | Fast gate passes. The first run exited 1 on two lint errors: unformatted `ui/render.mjs` (group P, fixed in aa77177) and my `forEach` callback return (fixed in e4093e1). Crate: 2 tests; locate: 2 pass; vendor tree unchanged. |
| Group c: repro, predicate and prove, then `repeat.mjs 5` and `concurrent2.mjs` | 0 | 9 pass; 4/4 in each of 7 repeated or concurrent runs |
| Group u: CMD-UI, including 5 repeats and 2 concurrent copies | 0 | 4/4 in each run |
| `FOLEY_OFFLINE=1 node --test test/e2e/` | 0 | 2 pass |
| `FOLEY_OFFLINE=1 node --test test/s4x/*.test.mjs` | 0 | 6 pass |
| `npm run demo:offline` | 0 | |
| `node tools/check-public.mjs --tree .` | 0 | 424 files, 0 findings |
| `node tools/check-public.mjs --self-test fixtures/public-negative/` | 0 | 9/9 classes caught; clean control passes |
| `az-lint --changed main` | 0 | |
| `az-simplicity --changed main --format json` (advisory) | 0 | One open finding in my files: `checkTree` in `tools/check-public.mjs`, complexity 25 and 51 lines. The complexity predates this repair (25 before it) and the function was longer before. |

The group a, c, u, ember, e2e, s4x and demo suites ran before 7435570 and
e4093e1. Those two commits change only `tools/check-public.mjs`, which none of
those suites runs. After them I reran ember, e2e, s4x, the demo, group b and
group L.

## Failure states

| State | Handling |
| --- | --- |
| Crash during an eval or backlog model call | The Ember ledger keeps the reservation booked. The next issue's envelope counts booked amounts as spent, so a crash never frees budget. |
| Rerun or resume after a crash | Backlog state prevents finished stages from repeating. Each issue's case budget is recomputed from the ledger, which includes earlier spend, so a retry cannot exceed the envelope or the per-issue cap. |
| Concurrent `eval` and `backlog` | Both hold the run lock (`lockRun`) for the whole census run, and every reservation goes through the ledger lock. Issues run one at a time, so the envelope read before an issue cannot be overtaken by another issue in the same process. |
| Envelope used up | The case budget becomes 0. Ember refuses the reservation (`budget_refused`) before any request, and the issue records `attempted_miss`. |
| Over-ceiling or malformed budget | `budget_refused`, exit 2, before the census is read or any request is made, dry runs included. |
| `eval` crashes after the held-out backlog pass but before the merge | `out/backlog-report.json` briefly holds only held-out rows. The run states under `out/runs/` are untouched, and the next `foley backlog` or `foley eval` rebuilds the full report from them. Report writes are atomic (temp file and rename). |
| Unreadable or corrupt ledger | The envelope read throws inside the stage, so the stage records `error` and the issue `attempted_miss`. Ember also refuses with `ledger_unreadable`, so nothing is spent. |
| Crate, preflight, public check | Read-only, no state, so no crash, concurrency or retry states. |

## Code-simplicity return

Reused: `score` (pure scoring), `backlog`, `preflight`, `openRun`, `lockRun` and
the Ember ledger as the spend authority. The existing census-to-stages code was
moved into `processCensus`, not copied, and `eval` reuses it.

New abstractions, each with one reason:
- `budget` and `perIssueBudget`: the envelope trust boundary;
- `envelope`: per-issue cap derived from the ledger;
- `heldOutIds`: the population boundary;
- `evaluate`: explicit held-out rows;
- `mergeReport`: keeps backlog rows outside the held-out set;
- `node_paths` (crate): node id to path resolution;
- `checkLine`: per-line text checks.

Kept under "Never cut": label validation before any call, budget refusal before
any call, and strict JSON parsing at the crate's input boundary.

## Tests I believe are wrong

None on the final head. The interface and tests first pinned Node 22.12.0. I
recorded the 22.13.0 proof above, and the Test Implementer moved both to
22.13.0 (`logs/W3R-L-INTERFACE.md`; test commit 690893e) before the final run.

## Amendments

- 2026-11-25: The Node minimum is 22.13.0, not 22.12.0, because the isolation
  path needs the stable `--permission` flag.
- 2026-11-25: `eval` makes new attempts only when `--target` is given and
  `--max-issues` is not `0`. Without them it scores existing results, as
  before.
- 2026-11-25: `--case-budget` keeps working for `backlog` and is capped at
  400000 micro-dollars, the same ceiling as `--per-issue-usd`. The `run`
  command's `--case-budget` is unchanged.

## Remaining risks

1. **Commit history still holds the old metadata.** Commits before 14de507
   contain the removed return lines. Rewriting history needs the owner, and
   this repair does not do it.
2. **Envelopes count only their own population.** Spend on the same issue from
   an earlier `foley run` counts against it, which errs low. Spend on other
   issues is outside the envelope and is capped only by the global ledger.
3. **The `assignment-metadata` class matches line shapes, not meaning.** A
   return that states its route in free prose without a field label is not
   caught.
4. **Node 22.13.0 is not tested on that exact release.** The minimum comes from
   the Node changelog. The gates ran on the installed Node 22.23.4.

## Blocker

None.
