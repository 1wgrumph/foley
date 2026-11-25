# S5 return: live core proof

Author: the S5 Implementer. Date: 2026-11-25. Branch `wave-4`. Not pushed.

## Outcome: OWNER_DECISION_REQUIRED

No live pair run reached `proof_verified`, so the verified count is 0
(TC-R15-3: 0 means OWNER_DECISION_REQUIRED, never PASS). Each live run found a
real defect, and six were fixed (listed below). With those fixes the pipeline
went further on each run:
- 10840 attempts 1 and 2: Watch named the right predicate and reproduction
  showed the failure on the bug build.
- 10840 attempt 2: every test the model wrote ran.

The packet allows at most three runs per pair, and all three pairs have used
them. Spend is $0.079642 of the $2.86 stop.

**The decision needed:** authorize further attempts on these pairs under the
fixes now in place (next changes are named under "Next changes"), or take the
plan's downgrade to watch, locate and report.

## Ledger

| Item | Spend (micro-USD) |
| --- | --- |
| S3 probe | 13,761 |
| S3b pilot | 2,184 |
| S5 pair runs | 59,738 (9852: 13,332; 10840: 41,591; 8418: 4,815) |
| S5 diagnosis (one Watch call on 9852; one reproduction on 8418) | 3,959 |
| Total on the live ledger (`node bin/foley.mjs spend`) | 79,642 |

Every call settled from the API's usage. Nothing is booked or open.

## Runs

Each command: `node bin/foley.mjs run --pair <issue> --recording
media/cache/<sha256>.mp4 --case-budget 500000`, with the key loaded into the
process only. The recordings are the reporters' public videos, copied into the
ignored `media/cache/` under their SHA-256. Missed runs are kept in
`out/runs.miss/<issue>-attempt<n>/`; the last run of each pair is in
`out/runs/<issue>/`. The summary is `out/core/summary.json`.

| Run | Stages | Verdict | Cause of the miss | Change before the next run |
| --- | --- | --- | --- | --- |
| 9852, attempt 1 | watch ok, locate ok, repro `no_predicate` | attempted_miss | Watch saw only the video and returned `predicate: null`: the issue text never reached it | Watch gets the issue title as quoted data |
| 9852, attempt 2 | watch `malformed_output` | attempted_miss | The model left `to_y` out of four horizontal drags, and the whole steps document was refused; its predicate (`elements[0].isDeleted`) was also wrong | The prompt requires every pointer field and lists the app state keys a predicate can read |
| 9852, attempt 3 | watch ok (predicate `appState.activeTool.type`, expected `line`, observed `eraser`), repro `not_reproduced` | attempted_miss | Product defect: `repro` checked the predicate about 30 ms after the last action, before Excalidraw's debounced state save | `repro` waits 1 s before the check (fixed after this run; 9852 had no runs left) |
| 10840, attempt 1 | watch ok (selection against hand), repro `reproduced`, prove `not_verified` | failure_observed | Prove rounds: `malformed_candidate` twice (the `assertion` name had spaces; the feedback did not say which rule failed), then a call to a missing API, then a missing import path | The prompt states the assertion format, the feedback names the rule, and pair runs pass a target test note |
| 10840, attempt 2 | watch ok, repro `reproduced`, prove `not_verified` | failure_observed | All four test candidates passed on the bug build (`wrong_predicate`): Watch's steps lack the laser key and Escape, and prove did not see the issue title | Prove gets the issue title |
| 10840, attempt 3 | watch ok, repro `not_reproduced` | attempted_miss | Model variance: Watch added a final "click Selection tool" step, which hides the failure | none; no runs left |
| 8418, attempt 1 | watch ok, repro `not_reproduced` | attempted_miss | Watch's predicate selector was `button`, which matches the page's first button, not the copy button | The prompt says the selector must match only the failing element and allows `:has-text()` |
| 8418, attempt 2 | watch ok (`button:has-text("Copy to clipboard")`, expected `Copied`), repro `not_reproduced` | attempted_miss | The second reproduction turn was refused as `malformed_output` (content not a JSON object), which ends reproduction by design (TC-R06-3/whole-turn) | Every chat request asks for JSON mode (`response_format: json_object`); reproduction also gets the issue title |
| 8418, attempt 3 | watch ok (same predicate, expected `Copied to clipboard`), repro `not_reproduced` | attempted_miss | The first reproduction turn was again `malformed_output` at the client, despite JSON mode | none; no runs left |

A diagnostic rerun of 8418's reproduction (`out/core/repro-diag.mjs`, $0.002569)
returned six well-formed turns. The model opened the export dialog from the
main menu on its own. Its last turn failed `validTurn`, which ended the
attempt. That attempt counted as reproduced only because the Watch predicate
(`button:has-text("Copy to clipboard")` showing "Copy to clipboard") also holds
before the click: the predicate is too weak to separate the builds. The
client-level malformed reply did not recur, so its cause is unknown.

Usage anomaly, seen three times: when a request repeats an earlier one exactly
(8418 attempt 3's Watch call repeated attempt 2's; S3 call 9), the API reports
a small `prompt_tokens` (110 here) with `cached_tokens` 0. The ledger records
what the API reports.

There was no verified test, so there was no rerun without Ember (TC-R15-2)
and no core proof: `out/core/core-proof.json` records `not_achieved`.

## Defects found live and fixed

| Defect | Class | Fix | Regression evidence |
| --- | --- | --- | --- |
| Watch never received the report's text | Product | `watch` takes `reportTitle`. Pair runs pass the pair's title and backlog runs pass the census title, quoted as data and limited to 300 characters | TC-R04-6 extended: the title reaches the model as quoted text. Red on the previous `src/watch.mjs`, green now |
| Pointer steps came back missing fields | Model behaviour, prompt | The prompt requires every pointer field | Live: 9852 attempt 3 and every later Watch reply validated |
| Predicates named the wrong state | Model behaviour, prompt | The prompt lists the app state keys a `canvas_state` predicate can read | Live: right predicate on 9852 attempt 3 and on all three 10840 runs |
| Reproduction checked the page before Excalidraw saved its state | Product | `repro` waits `SETTLE_MS` (1 s) before `checkPredicate` | Scripted check `out/core/settle-check.mjs`: scripted `repro` (no model) of 9852 attempt 3's Watch steps on the bug build, run unchanged. `not_reproduced` (exit 1) before the fix, `reproduced` (exit 0) after |
| Prove's malformed-candidate feedback named no rule, and the prompt did not state the assertion format | Product | Both now state it | Live: no `malformed_candidate` after the fix |
| Prove had no target test conventions and no issue title | Product | `prove` takes `testNotes` (from `test_notes` in `fixtures/pairs/pairs.json`, written once for the target) and `reportTitle` | TC-R07-1 extended: both reach the model. Red on the previous `src/prove.mjs`, green now. Live: 10840 attempt 2's candidates all imported and ran |
| A reply's content came back as something other than a JSON object | Model behaviour; client | Every chat request sets `response_format: {"type":"json_object"}`; reproduction also receives the issue title | The ember harness's expected body includes JSON mode: TC-R01-1 fails on the previous client and passes now. Live: 8418 attempt 3 still had one malformed reply (open risk) |

Disclosure: the target test note was written by the Implementer from
Excalidraw's own test helpers. It covers how this target's tests render the
editor and which helpers exist. It contains no issue's answer, but it is
human-written context, and a reader of the proof should know that.

## Item 4: replay page

See "Replay" below.

## Changed paths

- `src/watch.mjs`: report title, pointer-field and selector rules, the state
  key list.
- `src/ember.mjs`: JSON mode on every chat request.
- `src/repro.mjs`: settle wait before the check; issue title in the request.
- `src/prove.mjs`: assertion format, rule in the malformed feedback, target
  test notes and report title in the request.
- `src/run.mjs`, `bin/foley.mjs`: pass `reportTitle` and `testNotes`.
- `fixtures/pairs/pairs.json`: `test_notes`.
- `test/stages/watch/index.js`: TC-R04-6 extended.
- `test/stages/prove/index.js`: TC-R07-1 extended.
- `test/ember-harness.mjs`, `test/stages/support.mjs`: the expected request
  body includes `response_format`.
- `changelog.d/wave-4.md`, `logs/S5-RETURN.md`.

## Commands and exit codes

See "Gate" below.

## Next changes, if more attempts are authorized

1. 9852: rerun as is. The settle fix was proven on its own Watch steps after
   its last run.
2. 10840: Watch's frames miss key presses that leave no mark on screen (K,
   Escape). Prove now sees the title, which names the laser pointer; rerun to
   test whether that is enough.
3. 8418: the Watch predicate needs the state after the click. A selector
   that holds before the click cannot separate the builds; the prompt could
   ask for a predicate that is false before the reported action.

## Remaining risks

1. Watch output varies between runs on the same recording (10840 attempt 3),
   and a reply can still come back malformed in JSON mode (8418 attempt 3).
2. Key presses that leave no visible trace are invisible to Watch.
3. The target test note is human-written context for prove (disclosed above).
4. The usage anomaly on repeated requests is unexplained; the owner's console
   shows whether Meta bills those calls by the reported usage.

## Blocker

The verified count is 0 and two pairs have no attempts left under the packet;
the owner decides between further attempts and the downgrade.
