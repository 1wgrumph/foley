# S6 return: repeatability, held-out evaluation, census backlog

Author: the S6 Implementer. Date: 2026-11-25. Branch `wave-4`. Not pushed.

## Outcome: PASS

- **Repeatability:** issue 9852 verified on 3 of 5 unchanged runs.
- **Held-out evaluation:** 1 of 8 `failure_observed` (9812) and 7
  `attempted_miss`; no proof verified.
- **Census:** every one of the 50 issues has a status. 36 were attempted
  (5 `failure_observed`, 31 `attempted_miss`), 12 are excluded as
  `unsupported_device`, 2 are excluded as `excluded_sensitive_or_security`,
  and 0 were not run.

Census issues have no fixed build, so their best verdict is
`failure_observed`.

Live ledger total: 1,304,275 micro-USD, against the 5,300,000 stop. Spend per
item, each under its ceiling:

| Item | Spend (micro-USD) | Ceiling (micro-USD) |
| --- | --- | --- |
| Repeatability | 104,590 | 400,000 |
| Evaluation | 137,494 | 1,500,000 |
| Backlog | 683,791 | 3,000,000 |

## Frozen head and the one post-freeze fix

- **Freeze:** at 00e38f7 (product code as at 015abc8; later commits changed
  only the S5 return). Repeatability and the held-out evaluation ran on this
  head.
- **The fix, 969faa0:** after the evaluation, its output showed a defect that
  stops runs. Ember often writes a sentence before its JSON object, even in
  JSON mode, and the client refused the whole reply. Six of the seven
  held-out misses stopped on it, and the 9812 proof spent all 16,000 output
  tokens on reasoning.
  - The client now takes the JSON object that follows any leading text. It
    is still validated as before.
  - Prove treats a reply that is not a JSON object as a failed round with
    feedback, not the end.
  - Tests: TC-R01-6 is red on 00e38f7 and green after; TC-R07-1/malformed-round
    likewise.
  - The offline gate passed after the fix.
- **Held-out disclosure:** the eight held-out issues were run on 00e38f7,
  before the fix, and were not rerun. Product code, prompts and notes did not
  change in response to any held-out content: the fix addresses a reply
  format, seen only as the client's parse failure.
- **Backlog:** the 28 new backlog issues ran on 969faa0.

## 1. Repeatability (`foley run --pair 9852`, five unchanged runs)

| Run | Verdict | Cost (micro-USD) | Wall time | Miss cause |
| --- | --- | --- | --- | --- |
| 10 | attempted_miss | 31,716 | 182s | Watch predicate `activeTool.type` observed `freedraw`, kept through the rounds; reproduction ended on an invalid turn |
| 11 | attempted_miss | 26,059 | 165s | Watch predicate observed `freedraw`, kept through the rounds; failure not shown |
| 12 | proof_verified | 13,285 | 118s |  |
| 13 | proof_verified | 14,185 | 111s |  |
| 14 | proof_verified | 19,345 | 134s |  |

Verified: 3 of 5. The demo artefact is run 12: one Watch call, $0.013285,
118 s. It is kept as `out/demo/9852/` with its replay page re-rendered from
the run data; `checkCoreProof` returns `ok`. In both misses Watch picked a
wrong predicate (`freedraw`). The rule that keeps a readable predicate across
Watch rounds then held on to it: that is the cost of the S5 keep-predicate
mechanism.

## 2. Held-out evaluation (`foley eval`, 8 issues, serial)

Command: `node bin/foley.mjs eval --target out/census-target --app-origin
<loopback> --runner vitest --budget-usd 1.50`. Exit 0, 716 s. Results are in
`out/eval/results.json` and `out/eval/eval-report.json`.

| Issue | Verdict | Stages | Cost (micro-USD) | Time (s) | Miss cause |
| --- | --- | --- | --- | --- | --- |
| 11223 | attempted_miss | watch ok, locate ok, repro not_reproduced, report ok | 30,506 | 198.2 | reproduction: failure not shown |
| 10928 | attempted_miss | watch ok, locate ok, repro not_reproduced, report ok | 13,703 | 65.1 | reproduction: malformed_output |
| 10898 | attempted_miss | watch ok, locate ok, repro not_reproduced, report ok | 16,255 | 103.6 | reproduction: malformed_output |
| 10000 | attempted_miss | watch ok, locate ok, repro not_reproduced, report ok | 48,931 | 216.9 | reproduction: malformed_output |
| 9960 | attempted_miss | watch ok, locate ok, repro not_reproduced, report ok | 4,649 | 16.6 | reproduction: malformed_output |
| 9812 | failure_observed | watch ok, locate ok, repro reproduced, prove not_verified, report ok | 13,292 | 75.8 | proof: malformed_output |
| 8989 | attempted_miss | watch ok, locate miss, repro not_reproduced, report ok | 5,428 | 19.5 | reproduction: malformed_output |
| 9710 | attempted_miss | watch ok, locate miss, repro not_reproduced, report ok | 4,730 | 19.1 | reproduction: malformed_output |

Summary from the report:
- success per attempt: 0.125 (1 of 8 `failure_observed`, 0 verified)
- top-1 and top-5 anchors: 0
- cost per attempt: 17,187 micro-USD

The `malformed_output` stops in this table are the leading-prose defect
fixed afterwards in 969faa0. No held-out issue was rerun.

## 3. Census backlog (`foley backlog`, 50 issues, serial)

Command: `node bin/foley.mjs backlog fixtures/census/census.json --target
out/census-target --app-origin <loopback> --runner vitest --budget-usd 3.00`.
Exit 0, 4,524 s. The census index is in every replay page (re-rendered with
the final 50 rows) and in `out/backlog/index.html`. Data is in
`out/backlog/rows.json`, `results.json`, `summary.json` and `census.json`.

Counts: 36 attempted + 12 unsupported_device + 2 excluded_sensitive_or_security
+ 0 not run = 50. The 8 held-out issues are among the 36 attempted (run by
the evaluation and left unchanged by the backlog).

Miss causes among the 31 `attempted_miss`, all at reproduction:
- **Invalid turn (21):** the turn broke a turn rule and stayed invalid after
  its one re-ask. 6 of these are the held-out leading-prose stops.
- **Failure not shown (10):** the page never showed the failure.

In the 15 backlog-only invalid-turn stops, the rules broken were:
- `type` with no selector: 37 rejected turns. The model types into whatever
  has focus, such as the text editor.
- The observation or done rules: 19.
- Pointer actions with missing coordinates or a stray selector: 12.

Fixing `type` needs a backlog rerun; it is the next change, not made in this
slice.

The five `failure_observed` issues (12720, 10855, 9812, 9240, 9049)
reproduced on the pinned build. Their proofs stop at `inconclusive`: a red
test has no control without a fixed build. Prove does not save that red test,
so the "test that fails on the pinned build" is not kept as a file. That is
a gap, not a run-stopping defect, so it was not fixed.

| Issue | Status | Set | Cost (micro-USD) | Time (s) | Reason or miss cause |
| --- | --- | --- | --- | --- | --- |
| 12720 | failure_observed | census | 10,995 | 76.1 | proof: inconclusive (no fixed build: a red test has no control) |
| 12650 | unsupported_device | census | 0 |  | Firefox on Wayland only; Foley drives Chromium |
| 12405 | attempted_miss | census | 9,469 | 50.0 | reproduction: malformed_output |
| 12300 | attempted_miss | census | 53,906 | 310.6 | reproduction: failure not shown |
| 11842 | attempted_miss | census | 31,878 | 204.3 | reproduction: malformed_output |
| 11798 | attempted_miss | census | 9,186 | 76.0 | reproduction: malformed_output |
| 11796 | attempted_miss | census | 7,879 | 58.0 | reproduction: malformed_output |
| 11795 | excluded_sensitive_or_security | census | 0 |  | recording shows the reporter's name in an Excalidraw+ workspace sidebar |
| 11401 | unsupported_device | census | 0 |  | touchpad tap gestures |
| 11223 | attempted_miss | held-out | 30,506 | 198.2 | reproduction: failure not shown |
| 11173 | unsupported_device | census | 0 |  | pen tablet input |
| 11111 | unsupported_device | census | 0 |  | mobile only |
| 11042 | unsupported_device | census | 0 |  | IME composition input |
| 10928 | attempted_miss | held-out | 13,703 | 65.1 | reproduction: malformed_output |
| 10898 | attempted_miss | held-out | 16,255 | 103.6 | reproduction: malformed_output |
| 10863 | attempted_miss | census | 24,043 | 181.6 | reproduction: malformed_output |
| 10855 | failure_observed | census | 38,031 | 222.5 | proof: inconclusive (no fixed build: a red test has no control) |
| 10688 | attempted_miss | census | 44,325 | 257.6 | reproduction: failure not shown |
| 10661 | attempted_miss | census | 40,014 | 241.3 | reproduction: failure not shown |
| 10568 | attempted_miss | census | 5,648 | 22.0 | reproduction: malformed_output |
| 10480 | attempted_miss | census | 48,343 | 303.2 | reproduction: failure not shown |
| 10407 | attempted_miss | census | 33,873 | 300.3 | reproduction: failure not shown |
| 10128 | attempted_miss | census | 47,116 | 303.8 | reproduction: malformed_output |
| 10015 | attempted_miss | census | 14,542 | 97.9 | reproduction: malformed_output |
| 10000 | attempted_miss | held-out | 48,931 | 216.9 | reproduction: malformed_output |
| 9980 | unsupported_device | census | 0 |  | mobile only |
| 9960 | attempted_miss | held-out | 4,649 | 16.6 | reproduction: malformed_output |
| 9938 | attempted_miss | census | 15,146 | 85.0 | reproduction: malformed_output |
| 9871 | attempted_miss | census | 19,276 | 118.4 | reproduction: malformed_output |
| 9864 | attempted_miss | census | 14,930 | 106.0 | reproduction: malformed_output |
| 9815 | attempted_miss | census | 16,774 | 148.2 | reproduction: malformed_output |
| 9812 | failure_observed | held-out | 13,292 | 75.8 | proof: malformed_output |
| 9782 | attempted_miss | census | 10,578 | 64.2 | reproduction: malformed_output |
| 9755 | attempted_miss | census | 24,033 | 158.7 | reproduction: failure not shown |
| 9710 | attempted_miss | held-out | 4,730 | 19.1 | reproduction: malformed_output |
| 9663 | excluded_sensitive_or_security | census | 0 |  | recording shows the reporter's local folder and file names in a file picker |
| 9517 | unsupported_device | census | 0 |  | iOS long-press |
| 9510 | unsupported_device | census | 0 |  | reported as macOS-only |
| 9509 | attempted_miss | census | 44,269 | 341.5 | reproduction: failure not shown |
| 9464 | attempted_miss | census | 4,621 | 17.2 | reproduction: malformed_output |
| 9441 | unsupported_device | census | 0 |  | tablet pen input |
| 9410 | attempted_miss | census | 12,270 | 85.8 | reproduction: malformed_output |
| 9257 | attempted_miss | census | 43,246 | 310.7 | reproduction: failure not shown |
| 9240 | failure_observed | census | 15,047 | 89.8 | proof: inconclusive (no fixed build: a red test has no control) |
| 9170 | unsupported_device | census | 0 |  | touchpad gestures over a frame name |
| 9141 | unsupported_device | census | 0 |  | phone only; reporter says not on desktop |
| 9115 | attempted_miss | census | 23,734 | 169.4 | reproduction: failure not shown |
| 9049 | failure_observed | census | 20,619 | 120.3 | proof: inconclusive (no fixed build: a red test has no control) |
| 9032 | unsupported_device | census | 0 |  | stylus on iPad |
| 8989 | attempted_miss | held-out | 5,428 | 19.5 | reproduction: malformed_output |

## 4. Redacted trace of the verified 9852 run

`trace/9852/` (committed):
- `summary.json`: 7 calls, 14,280 input, 23,478 output (21,511 reasoning),
  13,285 micro-USD.
- `calls.json`: each call's kept request record (text, with images as
  SHA-256 digests), outcome, tokens and cost.
- `replies.json`: each reply's validated record: Watch's steps, reproduction's
  actions and observations, the accepted test and runner results. Foley does
  not store raw reply text.

Checks: `node tools/check-public.mjs --tree .` exit 0; `gitleaks detect
--no-banner --redact` exit 0; a scan for the key value found it in no file.
The run's Watch request repeated an earlier one exactly and was billed at a
small `prompt_tokens`: the repeated-request usage anomaly seen since S3.

## Media

All 36 eligible recordings were downloaded from their census URLs into the
ignored `media/cache/` (`out/s6/fetch-media.mjs`). All 36 match their census
size and SHA-256, and `clamdscan` reported them clean. None is committed. I
did not view any held-out issue page or recording.

## Changed paths

- `src/ember.mjs`, `src/prove.mjs`, `test/ember/index.js`,
  `test/stages/prove/index.js` (969faa0)
- `trace/9852/` (new)
- `changelog.d/wave-4.md`, `logs/S6-RETURN.md`

## Commands and exit codes

| Command | Exit | Result |
| --- | --- | --- |
| `out/core/pair.sh 9852 10` to `14` | 1, 1, 0, 0, 0 | 3 verified |
| `foley eval ... --dry-run`, then live | 0, 0 | 8 issues |
| `foley backlog ... --dry-run`, then live | 0, 0 | 50 issues |
| `node bin/foley.mjs spend` after items 1, 2, 3 | 0 | 482,990; 620,484; 1,304,275 |
| Offline gate after 969faa0 (ember, stages, ui, e2e, s4x, w3r, s5w, demo) | 0 each | 50; 25; 4; 2; 6; 42; 13 + 1 skipped |
| `az-lint --changed main` | 0 | |
| `gitleaks detect --no-banner --redact` | 0 | |
| `node tools/check-public.mjs --tree .` | 0 | 0 findings |
| `clamdscan --fdpass --multiscan media/cache/` | 0 | clean |
| `az-simplicity --changed main --format json` (advisory) | 0 | 35 selected paths, all checked by Biome. 3 findings in the files this slice touched: cognitive complexity 22 in `src/ember.mjs` (two functions), and 24 in `prove` in `src/prove.mjs`, up from 22 with the malformed-round branch. Not refactored in this slice. Friction: none |

## Remaining risks

1. Repeatability is 3 of 5; Watch's predicate choice varies between runs.
2. The held-out number is from the head before the prose fix; with the fix it
   is unmeasured.
3. `type` with no selector rejects whole turns. It is the largest backlog
   miss cause.
4. Census proofs leave no saved red test.
5. The repeated-request usage anomaly is unexplained; the owner's console
   shows billing.

## Blocker

None.
