# S6b return: census yield

Author: the S6b Implementer. Date: 2026-11-25. Branch `wave-4`. Not pushed.

## Outcome: PASS

The five defects S6 measured are fixed at the root, each with a red-then-green
regression. The frozen head 17791cf was rerun on all three populations:

- **Census:** observed failures rose from 5 to 11 of 36 attempted, and invalid
  reproduction turns fell from 21 to 0.
- **Held-out:** the second run gives 2 of 8 `failure_observed` against 1 of 8
  on the first run, which still stands.
- **9852:** verified on 5 of 5 runs, against 3 of 5 in S6.

The goal was more observed failures **with a kept failing test**. Observed
failures rose; kept failing tests did not. No run reached the new verdict
`failing_test_no_control`. Of the 29 rejected red-test rounds, Ember's test
passed on the bug build in 20, and failed in 9 with values unrelated to the
predicate. The new rule kept none of those, as designed; see Remaining risks.

Live ledger total: 2,576,656 micro-USD, against the 4,300,000 stop. Spend per
rerun, each under its ceiling:

| Rerun | Spend (micro-USD) | Ceiling (micro-USD) |
| --- | --- | --- |
| Census | 965,710 | 2,000,000 |
| Held-out | 274,241 | 600,000 |
| 9852 repeats | 32,430 | 300,000 |

## Fixes (frozen at 17791cf)

| Defect | Fix | Regression test (red on 493970e, green on 17791cf) |
| --- | --- | --- |
| (a) `type` with no selector refused | `type` with no selector types into the focused element only; a `type` aimed at a selector not on the page runs nothing (`action_error`) | TC-R06-1/focused-type (new fixture text field in the stage apps) |
| (b) A free-text verdict on an unfinished turn refused the turn | when `done` is false, a verdict outside the closed set is dropped (it never decides anything); a finished turn still needs `reproduced` or `not_reproduced`; the run document keeps only closed-set verdicts | TC-R06-3/canonical-turn |
| (c) Pointer actions refused whole | a drag missing exactly one end coordinate keeps its start value; a pointer click, double click or move with no coordinates but a selector is that element action. A drag with no end, any out-of-viewport or non-integer coordinate, and the whole-turn rule are unchanged | TC-R06-3/canonical-turn; TC-R06-3/pointer-whole-turn now lists a drag with no end as the refused case |
| (d) Census proofs kept no red test | with no fixed build, a red test that shows the predicate's actual and expected values is rerun without Ember. It is then kept as `regression.test.mjs`, with its failing output in `regression.red.txt`, under prove status `red_test` and run verdict `failing_test_no_control` (reproduced, with a failing test, no fixed-build control). The verdict is in the closed status set, the replay page and the census index, and counts as a success in scoring | TC-R07-1/red-test-no-control; TC-R09-1/failing-test-no-control (CLI: verdict, kept files, replay page); TC-R07-2/no-independent-control updated: still not a proof |
| (e) The keep-predicate rule held a wrong predicate | a Watch round does not keep a predicate whose expected value the bug build showed (9852 runs 10 and 11 read `eraser`, the predicate's own expected value, in every attempt) | TC-R06-7/watch-round-drops-contradicted |

Trust-boundary negative checks still pass in the gate:
- A turn with an out-of-viewport coordinate is refused whole
  (TC-R06-3/pointer-whole-turn, TC-R06-1/pointer-viewport).
- An off-origin navigation is blocked (TC-R06-2).
- A `type` aimed at a selector not on the page runs nothing
  (TC-R06-1/focused-type).

Amendment, 2026-11-25: the closed status set gains `failing_test_no_control`,
as this packet directs. The dated census fixture keeps its original status set,
because `tools/check-fixtures.mjs` compares the two exactly.

No product change was made after the freeze.

## Census before and after

The 28 non-held-out issues that ended `attempted_miss` or `failure_observed`
in S6 were rerun with `foley backlog` on 17791cf. Their S6 folders are kept
in `out/runs.s6/`. Exit 0, 7,027 s.

Transitions among the 28:
- 5 moved from `attempted_miss` to `failure_observed`;
- 4 stayed `failure_observed`;
- 19 stayed `attempted_miss`.

The held-out rows come from their second run. Counts now:

| Status | Count |
| --- | --- |
| `failure_observed` | 11 |
| `attempted_miss` | 25 |
| `unsupported_device` | 12 |
| `excluded_sensitive_or_security` | 2 |
| Total | 50 |

Every miss is now "failure not shown"; invalid turns went from 21 to 0. Data
is in `out/backlog/` (`rows.json`, `summary.json`, `census.json`,
`index.html`). All 36 replay pages were re-rendered with the final census
rows.

| Issue | Set | S6 status | S6b status | S6b rerun cost (micro-USD) | Time (s) | Reason or miss cause |
| --- | --- | --- | --- | --- | --- | --- |
| 12720 | census | failure_observed | failure_observed | 25,571 | 172.5 | proof: wrong_predicate |
| 12650 | census | unsupported_device | unsupported_device | 0 |  | Firefox on Wayland only; Foley drives Chromium |
| 12405 | census | attempted_miss | attempted_miss | 29,093 | 171.9 | reproduction: failure not shown |
| 12300 | census | attempted_miss | attempted_miss | 42,417 | 251.6 | reproduction: failure not shown |
| 11842 | census | attempted_miss | attempted_miss | 34,072 | 190.2 | reproduction: failure not shown |
| 11798 | census | attempted_miss | attempted_miss | 32,694 | 506.5 | reproduction: failure not shown |
| 11796 | census | attempted_miss | attempted_miss | 50,972 | 493.6 | reproduction: failure not shown |
| 11795 | census | excluded_sensitive_or_security | excluded_sensitive_or_security | 0 |  | recording shows the reporter's name in an Excalidraw+ workspace sidebar |
| 11401 | census | unsupported_device | unsupported_device | 0 |  | touchpad tap gestures |
| 11173 | census | unsupported_device | unsupported_device | 0 |  | pen tablet input |
| 11111 | census | unsupported_device | unsupported_device | 0 |  | mobile only |
| 11042 | census | unsupported_device | unsupported_device | 0 |  | IME composition input |
| 10863 | census | attempted_miss | failure_observed | 16,804 | 90.3 | proof: wrong_predicate |
| 10855 | census | failure_observed | failure_observed | 24,908 | 102.9 | proof: wrong_predicate |
| 10688 | census | attempted_miss | attempted_miss | 41,057 | 224.6 | reproduction: failure not shown |
| 10661 | census | attempted_miss | attempted_miss | 39,740 | 239.0 | reproduction: failure not shown |
| 10568 | census | attempted_miss | attempted_miss | 38,830 | 285.5 | reproduction: failure not shown |
| 10480 | census | attempted_miss | failure_observed | 36,955 | 218.5 | proof: wrong_predicate |
| 10407 | census | attempted_miss | attempted_miss | 65,761 | 476.3 | reproduction: failure not shown |
| 10128 | census | attempted_miss | attempted_miss | 37,972 | 288.5 | reproduction: failure not shown |
| 10015 | census | attempted_miss | attempted_miss | 57,793 | 493.4 | reproduction: failure not shown |
| 9980 | census | unsupported_device | unsupported_device | 0 |  | mobile only |
| 9938 | census | attempted_miss | attempted_miss | 35,754 | 249.3 | reproduction: failure not shown |
| 9871 | census | attempted_miss | attempted_miss | 32,174 | 228.4 | reproduction: failure not shown |
| 9864 | census | attempted_miss | attempted_miss | 25,765 | 177.3 | reproduction: failure not shown |
| 9815 | census | attempted_miss | failure_observed | 25,912 | 220.6 | proof: wrong_predicate |
| 9782 | census | attempted_miss | failure_observed | 34,968 | 233.8 | proof: wrong_predicate |
| 9755 | census | attempted_miss | attempted_miss | 31,092 | 196.7 | reproduction: failure not shown |
| 9663 | census | excluded_sensitive_or_security | excluded_sensitive_or_security | 0 |  | recording shows the reporter's local folder and file names in a file picker |
| 9517 | census | unsupported_device | unsupported_device | 0 |  | iOS long-press |
| 9510 | census | unsupported_device | unsupported_device | 0 |  | reported as macOS-only |
| 9509 | census | attempted_miss | failure_observed | 15,351 | 79.2 | proof: test_error |
| 9464 | census | attempted_miss | attempted_miss | 48,588 | 421.4 | reproduction: failure not shown |
| 9441 | census | unsupported_device | unsupported_device | 0 |  | tablet pen input |
| 9410 | census | attempted_miss | attempted_miss | 42,047 | 317.2 | reproduction: failure not shown |
| 9257 | census | attempted_miss | attempted_miss | 25,276 | 178.6 | reproduction: failure not shown |
| 9240 | census | failure_observed | failure_observed | 17,604 | 103.8 | proof: wrong_predicate |
| 9170 | census | unsupported_device | unsupported_device | 0 |  | touchpad gestures over a frame name |
| 9141 | census | unsupported_device | unsupported_device | 0 |  | phone only; reporter says not on desktop |
| 9115 | census | attempted_miss | attempted_miss | 29,099 | 247.4 | reproduction: failure not shown |
| 9049 | census | failure_observed | failure_observed | 27,441 | 163.5 | proof: wrong_predicate |
| 9032 | census | unsupported_device | unsupported_device | 0 |  | stylus on iPad |
| 11223 | held-out | attempted_miss | attempted_miss | 33,043 | 195.6 | reproduction: failure not shown |
| 10928 | held-out | attempted_miss | attempted_miss | 40,334 | 235.8 | reproduction: failure not shown |
| 10898 | held-out | attempted_miss | attempted_miss | 32,735 | 202.0 | reproduction: failure not shown |
| 10000 | held-out | attempted_miss | attempted_miss | 52,680 | 273.0 | reproduction: failure not shown |
| 9960 | held-out | attempted_miss | attempted_miss | 45,605 | 342.3 | reproduction: failure not shown |
| 9812 | held-out | failure_observed | failure_observed | 19,633 | 107.1 | proof: wrong_predicate |
| 9710 | held-out | attempted_miss | failure_observed | 16,336 | 104.0 | proof: wrong_predicate |
| 8989 | held-out | attempted_miss | attempted_miss | 33,875 | 217.3 | reproduction: failure not shown |

## Held-out: first run and second run

The first run (frozen head 00e38f7) stands in `out/eval/results.json`, with
its folders in `out/runs.eval1/`. The second run (17791cf) is in
`out/eval/run2/`. Second run: exit 0, 1,679 s; success per attempt 0.25
against 0.125. Nothing changed in response to held-out content.

| Issue | First run (00e38f7) | First miss cause | Second run (17791cf) | Second miss cause | Second run cost (micro-USD) | Second run time (s) |
| --- | --- | --- | --- | --- | --- | --- |
| 11223 | attempted_miss | reproduction: failure not shown | attempted_miss | reproduction: failure not shown | 33,043 | 195.6 |
| 10928 | attempted_miss | reproduction: malformed_output | attempted_miss | reproduction: failure not shown | 40,334 | 235.8 |
| 10898 | attempted_miss | reproduction: malformed_output | attempted_miss | reproduction: failure not shown | 32,735 | 202.0 |
| 10000 | attempted_miss | reproduction: malformed_output | attempted_miss | reproduction: failure not shown | 52,680 | 273.0 |
| 9960 | attempted_miss | reproduction: malformed_output | attempted_miss | reproduction: failure not shown | 45,605 | 342.3 |
| 9812 | failure_observed | proof: malformed_output | failure_observed | proof: wrong_predicate | 19,633 | 107.1 |
| 8989 | attempted_miss | reproduction: malformed_output | attempted_miss | reproduction: failure not shown | 33,875 | 217.3 |
| 9710 | attempted_miss | reproduction: malformed_output | failure_observed | proof: wrong_predicate | 16,336 | 104.0 |

## 9852 repeats

| Head | Run | Verdict | Cost (micro-USD) | Wall time |
| --- | --- | --- | --- | --- |
| 00e38f7 (S6) | 10 | attempted_miss | 31,716 | 182s |
| 00e38f7 (S6) | 11 | attempted_miss | 26,059 | 165s |
| 00e38f7 (S6) | 12 | proof_verified | 13,285 | 118s |
| 00e38f7 (S6) | 13 | proof_verified | 14,185 | 111s |
| 00e38f7 (S6) | 14 | proof_verified | 19,345 | 134s |
| 17791cf (S6b) | 15 | proof_verified | 7,482 | 63s |
| 17791cf (S6b) | 16 | proof_verified | 7,462 | 76s |
| 17791cf (S6b) | 17 | proof_verified | 7,004 | 59s |
| 17791cf (S6b) | 18 | proof_verified | 5,059 | 66s |
| 17791cf (S6b) | 19 | proof_verified | 5,423 | 66s |

S6b gives 5 of 5. Run 18 replaces the demo artefact `out/demo/9852/` ($0.005,
66 s); its replay page is re-rendered and `checkCoreProof` returns `ok`.
These runs cost less partly because the Watch request repeats exactly, which
triggers the API's small-`prompt_tokens` usage anomaly.

## Changed paths

- `src/repro.mjs`, `src/prove.mjs`, `src/run.mjs`, `src/run-schema.mjs`,
  `src/backlog.mjs`, `src/score.mjs`, `ui/player.js`
- `fixtures/app/index.html`, `fixtures/app-fixed/index.html` (a text field
  that echoes input, for the focused-typing test)
- `test/stages/repro/index.js`, `test/stages/prove/index.js`,
  `test/w3r/R-artifacts.test.mjs`, `test/w3r/P.test.mjs`,
  `test/s5w/pointer.test.mjs`
- `changelog.d/wave-4.md`, `logs/S6b-RETURN.md`

## Commands and exit codes

| Command | Exit | Result |
| --- | --- | --- |
| Offline gate on 17791cf: ember, stages, ui, e2e, s4x, w3r (`FOLEY_EXCALIDRAW_TARGET` set), s5w, demo | 0 each | 50; 28; 4; 2; 6; 44; 13 + 1 skipped |
| `foley backlog fixtures/census/census.json --target out/census-target --app-origin <loopback> --runner vitest --budget-usd 2.00` | 0 | 50 issues |
| `foley eval --target out/census-target --app-origin <loopback> --runner vitest --budget-usd 0.60` | 0 | 8 issues |
| `out/core/pair.sh 9852 15` to `19` | 0 each | 5 verified |
| `node bin/foley.mjs spend` after each rerun | 0 | 2,269,985; 2,544,226; 2,576,656 |
| `az-lint --changed main` | 0 | |
| `node tools/check-public.mjs --tree .` | 0 | 0 findings |
| `gitleaks detect --no-banner --redact` | 0 | |
| `node tools/check-fixtures.mjs fixtures/` | 0 | |
| `az-simplicity --changed main --format json` (advisory) | 0 | 38 selected, 38 checked by Biome. Findings in files this slice changed: `prove` complexity 29 (was 24; the new red-test branch nearly duplicates the verified branch, so a shared rerun-keep-finish helper would remove both); `execute` complexity 24 (was 21); `ask` 59 lines; `pairOptions` 54 lines and complexity 21; the replay player's render function 57 lines. Not refactored: found after the freeze. Skill friction: the skill asks for the smallest complete change, and the freeze then blocks the follow-up simplification within the slice |

## Remaining risks

1. **No kept failing test yet.** Ember's tests on census issues either pass on
   the bug build or fail on unrelated values. Better prove context (the
   reproducing steps are already passed) or test helpers per target are the
   next lever.
2. **25 census misses are "failure not shown":** reproduction ran but the page
   never showed the predicate's value.
3. **Held-out yield is 2 of 8 `failure_observed`**, with no proof (no fixed
   builds).
4. **Repeated-request usage anomaly:** the 9852 costs above are partly low for
   this reason; it stays unexplained.

## Blocker

None.
