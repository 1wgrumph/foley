# S4x Test Implementer return

**Outcome: PASS (test implementation only).** Six new SEIT-suffixed tests
are red for their intended assertions on the unchanged product at
`305828d93f648652fa6aee4c2993b24396fffe62`. All 78 existing Node cases
remain green. Both implementation packets may use these tests without
changing them. The red tests are not evidence that the product is fixed.

Test and contract commit: `0f7e1fd91db7a277190eea49877bb93cde1e5baf`.
Resolve the return commit (final slice head) with
`git log -1 --format=%H -- logs/S4x-TESTS-RETURN.md`.
Branch: `wave-3`.

## Changed paths

| Path | Purpose |
| --- | --- |
| `test/s4x/observation.test.mjs` | Real offline Ember transport, owned archive app and CLI pipeline; action association, inclusive text bounds, omitted fields, prompt contract, malformed turns and credential-shaped text containment. |
| `test/s4x/census.test.mjs` | Real backlog scheduler with existing stage adapters and loopback Ember; pre-report publication, interruption, all closed statuses, resume, atomic replacement and no duplicates. |
| `test/s4x/ui.test.mjs` | Actual renderer and Chromium, contract-shaped run fixture from the existing owned recording and screenshot; visible explanations, text boundary, census links, offline open and axe. |
| `test/s4x/ids.txt` | Exact red/green ID inventory. |
| `logs/S4x-INTERFACE.md` | Independent implementation contracts for the two product groups. |
| `logs/S4x-red.receipt.json` | Exact six-ID assertion-red receipt. |
| `logs/S4x-TESTS-RETURN.md` | This handoff. |

New tests are separately invoked so the original group gates remain unchanged.
No existing case, fixture, dependency, product code or tool was modified.
The amended response fields are synthetic JSON sent by the existing fake
server through the real request/response transport. The positive pipeline
reaches the actual deterministic archive predicate and verified proof before
failing on missing action explanations. No actual credential or live endpoint
was used. The only HTTP exchanges were local test servers; browser requests
were confined by the existing controls.

## Verification commands and exits

Raw local evidence is retained under ignored `out/s4x/`. Every command uses
Node 22.23.4 and the existing installed dependencies. Test commands use
`FOLEY_OFFLINE=1`. The product source was identical for all runs.

| Command | Exit | Result |
| --- | ---: | --- |
| `FOLEY_OFFLINE=1 node --test --test-reporter=tap test/s4x/*.test.mjs` | 1 | 6/6 assertion failures; 0 pass/skip/cancel/todo; `red.log` |
| `node tools/red-receipt.mjs out/s4x/red.log --expect-ids test/s4x/ids.txt` | 0 | 6 exact IDs, each `ERR_ASSERTION` |
| `FOLEY_OFFLINE=1 node tools/repeat.mjs 5 test/s4x/*.test.mjs` | 1 | Expected red, all six in each of five runs, exit 1 and no signal, same reason per ID |
| `FOLEY_OFFLINE=1 node tools/concurrent2.mjs test/s4x/*.test.mjs` | 1 | Expected red, all six in both simultaneous copies, exit 1 and no signal, same reason per ID |
| `FOLEY_OFFLINE=1 node --test test/ember/` | 0 | 50/50 |
| `FOLEY_OFFLINE=1 node --test test/stages/watch test/stages/report test/stages/backlog test/stages/score test/stages/schema` | 0 | Group a, 11/11 |
| `FOLEY_OFFLINE=1 node --test test/stages/locate` | 0 | Group b Node, 2/2 |
| `FOLEY_OFFLINE=1 node --test --test-concurrency=1 test/stages/repro test/stages/predicate test/stages/prove` | 0 | Group c, 9/9 |
| `npm run build:ui` | 0 | UI built |
| `FOLEY_OFFLINE=1 node --test test/ui/` | 0 | Group u, 4/4 |
| `FOLEY_OFFLINE=1 node --test test/e2e/` | 0 | 2/2 |
| `biome check --write test/s4x/*.mjs` | 0 | Three new modules formatted and checked |
| `node tools/check-public.mjs --tree .` | 0 | Zero findings |
| `az-lint --changed main` | 0 | Format, lint and secret scan passed; zero Semgrep findings |
| `git diff --cached --check` | 0 | No whitespace errors |

All green suites had zero skipped, cancelled or todo cases. The repeat and
concurrent tools print 0/N passed because the subject intentionally lacks the
new behavior. Extracted TAP logs from both tools were checked individually
with the unchanged red-receipt tool; each checker exited 0. The first
assertion message per ID matched the direct red run in all seven copies.
No timing-derived assertions or sleeps were added. The first attempt to invoke
the new directory as `node --test test/s4x/` failed because it has no index
entry; the explicit file glob above is the verified command. The final red
rerun added prompt assertions, invalid second-action controls and both
credential-shaped fields in the CLI control.

Red TAP SHA-256:
`19f68b056b8c60b3d89b063725fedfd3d83b4825d91cc9ae850e0608f6fa7f86`.
Committed receipt SHA-256:
`1195c65c6681f1477898bec4e369253097d4f9786673c43e0f3e81b44e54f38e`.

| Red copy | TAP SHA-256 |
| --- | --- |
| Repeat 1 | `574aaf4faf471d2ea328c149e55508af9e28cb6e3622fdec044ea0a75b2d2f63` |
| Repeat 2 | `3fd03af30f901c8cd7f5d7edd1289d6a748663fa110699391618b466d963a40f` |
| Repeat 3 | `1bea24d19087b68cd3431604af71be7b51ed174d9d202599953c19e82d4b5f25` |
| Repeat 4 | `6e2436a30e1b9a856c886bca933fbaa5818967eef12bb0057dac427d1a9260e9` |
| Repeat 5 | `ad921e15036d04c3f67fc0d7dcba8d024216042cce8b12050df742a79f47e842` |
| Concurrent 1 | `a42b9099d35ff8294311c93537ce12a09a64888ea38e0f3797d0824aba4eabae` |
| Concurrent 2 | `6e376317f15f1c2a7ffd4507e96ccc984d3992661d02f97cf58fe6b0b2ab93af` |

## ID-to-case coverage and red classification

All failures are missing contracted behavior, not setup, imports, timeouts,
network, baseline regressions or infrastructure failures. The cases do not
rely on a model's claimed verdict as independent proof.

| ID | Case | First red assertion |
| --- | --- | --- |
| `TC-R06-1/observation` | Model turns include multiple actions, distinct reasons, a changed observation and a legacy reply. Inclusive 1,024/512 bounds. Verify exact per-action copies in replay and integrated run, and wire instructions. | Replay action observation and reason must match their model turn |
| `TC-R06-3/observation` | Both fields: numeric and null values, limit plus one, synthetic credential-shaped string. The bad reason is on the second action, so validating lazily is insufficient. All cases run before the matrix assertion. Scan owned artifacts for the sentinel. | Invalid observation or reason must stop the turn as malformed_output before executing an action |
| `TC-R06-5/observation` | Integrated run receives two credential-shaped explanations. Scan all generated output before testing refusal and no verified proof despite the model's success claim. | Malformed explanation must not produce a verified proof |
| `TC-R09-1/census-record` | Interrupt after issue 1 report; resume issue 2 (failure observed) and issue 3 (watch miss). Check all ten census rows including all seven statuses, pre-report record, earlier record update before next issue, final copies, no repeat, open original file descriptor unchanged. | First completed issue must publish its in-folder census before interruption |
| `TC-R14-1/observation` | Four rendered steps cover both fields present/absent independently. Inert markup is visible text, no corresponding element; both viewports pass the existing self-contained file and axe checks. | Every visible step must show its recorded model observation and reason, or not recorded |
| `TC-R14-1/census-index` | Eight rows cover seven statuses; two rows share a status but only one sibling has a replay. Check row text and resolved link targets; both viewports use axe and zero secondary requests. | Census must show every issue/status and link only to existing replay pages |

The interface chooses inclusive UTF-16 bounds of 1,024 and 512 and rejects
credential-shaped explanations as malformed rather than persisting them.
A census record is an array copied to each started run folder; updates are
atomic per file. Static links expose only verified issue-number paths at
render time; static census snapshots can be re-exported to see later rows.
The live server's read-only run-folder boundary remains unchanged.

## Limits and blocker

No blocker for the assigned red-test outcome. The new regions' actual
accessibility, complete field propagation, record publication and final green
receipt must be verified on the later product implementation. The current
product passes the unchanged accessibility and offline-open checks; missing
regions cannot themselves have demonstrated accessibility yet. No push,
product edits, external publication or real model call. Rust-only tests were
not rerun because this assignment changes only JavaScript tests and requires
the Node group gates. BRAN discovery was unavailable because no native policy
exists in the worktree; inspected source, contracts and existing fixtures
instead.
