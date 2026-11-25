# S3b return: computer-use pilot

Author: the S3b Implementer. Date: 2026-11-25. Branch `wave-4`, head faf7789. Not pushed.

## Outcome: PASS

The same known Excalidraw flow ran live on the local 9852 bug build with the
existing screenshot-and-action loop and with Ember's native computer-use tool.
Both reproduced the failure on the first attempt, with `checkPredicate` reading
the page. Neither wins clearly, so the loop stays the reproduction driver for
S5 and computer use is not wired into `repro`. Spend for this item: $0.002184
(2,184 micro-USD). Ledger total after S3 and S3b: $0.015945.

## Flow

Issue 9852's bug build (`out/pairs/9852/bug/excalidraw-app/build`), served on
loopback by `serveBuild`. Steps: press L, click the canvas, press E. Predicate:
`appState.activeTool.type` observed `eraser` (expected `line`).

## Comparison

| Run | Input to the model | Result | Model calls | Cost (micro-USD) | Input / output tokens | Wall time |
| --- | --- | --- | --- | --- | --- | --- |
| Loop, recorded steps with selectors | `pairs.json` steps and predicate | reproduced, attempt 1 | 1 | 631 | 1,637 / 933 | 4.6 s |
| Loop, recorded steps without selectors | the same steps, selectors removed (as Watch output would be) | reproduced, attempt 1; used `pointer_move` and `pointer_click` | 1 | 725 | 1,620 / 1,126 | 5.0 s |
| Native computer use, first run | the user steps as prose, predicate, first screenshot | stopped before any action: `pending_safety_checks` `computer_action_requires_confirmation` | 1 | 455 | | 3.5 s |
| Native computer use, second run | the same | reproduced; 4 actions in one batch with waits, then a final message | 2 | 373 | 1,672 / 358 | 9.0 s |

Recoveries: none were needed in any run. The computer-use driver acknowledged
only `computer_action_requires_confirmation`, because the page is a local build
behind the origin lock; any other check stops it. Its actions were mapped onto
Foley's validated action set (`pointer_click`, `key_press`, `wait`) and every
coordinate passed `validPointer`.

## Decision

Keep the loop. Both drivers reproduced first time at under $0.001. The loop is
faster here, is already wired into `repro` with its replay page, tests and
whole-turn validation, and needs no safety-check policy. Computer use cost
about half as much but took twice the wall time on this flow; wiring it would
add a second driver to maintain without a measured gain.
`callEmberComputer` stays in the governor, with an offline test, because it is
the metered path any later computer-use work must use.

## Changed paths

- `src/ember.mjs`: `callEmberComputer`, a stateless Responses API call
  (`store: false`, whole history replayed) with the same reservation,
  settlement and refusals as `callEmber`; every `data:` URL in the input must be
  a bounded PNG frame, priced at 1,600 tokens and kept on disk as its digest;
  the Responses usage names map onto the ledger's fields.
- `test/ember/index.js`: TC-R01-8 extended (stateless body and bound, a JPEG
  data URL refused before send, Responses usage settled).
- `changelog.d/wave-4.md`, `logs/S3b-RETURN.md`.
- Scratch drivers, not committed: `out/pilot/loop.mjs`,
  `out/pilot/loop-targets.mjs`, `out/pilot/cu.mjs`.

## Commands and exit codes

| Command | Exit | Result |
| --- | --- | --- |
| `node out/pilot/loop.mjs` | 0 | reproduced |
| `node out/pilot/cu.mjs` (first run) | 0 | not_reproduced, stopped on the safety check |
| `node out/pilot/cu.mjs` (acknowledging the confirmation check) | 0 | reproduced |
| `node out/pilot/loop-targets.mjs` | 0 | reproduced |
| `node bin/foley.mjs spend` | 0 | total 15,945 micro-USD |
| `FOLEY_OFFLINE=1 node --test test/ember/` | 0 | 50 pass |

## Remaining risks

1. One simple flow measures little: three actions with the steps known.
   Harder flows may separate the drivers.
2. The safety-check policy for computer use is the pilot's own; wiring computer
   use later needs it decided and tested.

## Blocker

None.
