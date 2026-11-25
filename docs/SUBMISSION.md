# Foley submission

This document holds the submission text, the three-minute demo script, and
the judging rubric and event rules mapped to evidence in this repository.
Every figure comes from the [README](../README.md) results, which name their
source files.

## Submission text

Foley takes the screen recording attached to a bug report and returns a
reproduced failure, a regression test that fails on the bug and passes on the
fix, and a replay page. The only model is Muse Ember (`muse-ember-1.0`)
through the Meta Model API. Ember watches the recording, drives a browser by
screenshot and pointer, and writes the test. Foley decides every verdict
itself: a page check decides whether the failure showed, and a sandbox runs
the test on the bug build and the fixed build.

On Excalidraw issue 9852, Foley went from the reporter's 23.4 s recording to
a Vitest test that fails on the bug commit and passes on the fix commit, in
66 s for $0.005059. It verified 5 of 5 unchanged runs. Two other real pairs
did not verify, and the README states why. On a dated census of 50 Excalidraw
bug reports with video, Foley observed the failure on 11 of 36 attempted
issues. It kept no failing test for any of them, because census issues have
no fixed build and Ember's tests did not show the failure. Total model spend
for the event was $2.576656, under a $9.00 stop enforced in code.

BRAN v0.4.0 (MIT OR Apache-2.0) is prior work, imported unchanged at the tag
`baseline-bran-v0.4.0`. Everything after that tag was built during the event.

## Demo script, three minutes

The owner records the screen. Open these before recording:

- `out/demo/9852/replay.html`, the replay page of the 9852 demo run (run 18).
  It embeds the reporter's recording, so it stays local and is not committed.
- The census index: the census panel inside the same replay page, or
  `out/backlog/index.html`.
- The repository's [README](../README.md) on GitHub.

| Time | What the owner shows | What the owner says |
| --- | --- | --- |
| 0:00 | Excalidraw issue 9852 on GitHub: a report with only a video | A maintainer must watch the video, guess the steps and write a test before a fix can start. Foley does that from the recording |
| 0:20 | Replay page, recording panel: play the reporter's recording | This is the input. Ember reads frames from it and returns steps and one failure condition: the active tool should stay `line`, and the recording shows `eraser` |
| 0:45 | Replay page, replay panel: step through the screenshots and the action feed | Ember sees a screenshot each turn and answers with key presses and pointer clicks. Foley checks the page itself. Here it read `eraser` on the bug build. The same actions on the fixed build do not show it |
| 1:15 | Replay page, test panel: the Vitest test, bug FAIL and fixed PASS | Ember wrote this test in Excalidraw's own test runner. It fails on the bug commit with `expected 'eraser' to be 'line'` and passes on the fix commit. Foley reran it with no model and no key: same result |
| 1:40 | Replay page, model-call list; then README "One verified result" | The page lists every model call made for this issue across all its runs, $0.257391 in total. This run alone took 66 s and $0.005059, from the ledger. 5 of 5 unchanged runs verified. This run's Watch call reported an unusually small token count, which the README explains |
| 2:00 | Census index | The same pipeline on 50 real reports: 11 failures observed, 25 misses, 14 excluded for touch, pen, mobile, other platforms or private content. No census issue has a kept failing test, and the held-out set gave 1 of 8 on its first run. These are the misses as well as the hit |
| 2:30 | README, "Spend" and "Prior work and event work" | Total spend $2.576656, under a $9.00 stop in the code. BRAN v0.4.0 is prior work, unchanged; everything after the baseline tag was built this week. The offline demo runs with `npm run demo:offline` |
| 2:55 | End | |

Recorded runs are shown as recorded runs, not as live.

## Rubric to evidence

| Criterion (weight) | Evidence |
| --- | --- |
| Impact (30) | README "One verified result" and "Results": 9852 verified in 66 s for $0.005059, 5 of 5 repeats; census of 50 with 11 failures observed and every miss listed in [`evidence/census-rows.json`](evidence/census-rows.json) |
| Meta AI tooling (25) | Muse Ember is the only model (`src/ember.mjs`). It watches frames (`src/watch.mjs`), acts on screenshots with pointer actions (`src/repro.mjs`) and writes tests (`src/prove.mjs`). README "Measured Ember facts": video against frames token cost, the `max_completion_tokens` limit and reasoning effort, audio not usable, the repeated-request usage figure; native computer use measured against the loop. Trace: [`trace/9852/`](../trace/9852/) |
| Technical depth (20) | [ARCHITECTURE.md](ARCHITECTURE.md) and [SAFETY.md](SAFETY.md): a page check instead of the model's verdict, fixed-build replay, a namespace sandbox for model-written tests (`tools/isolate.sh`), a reserve-before-send ledger under a lock, a resumable stage journal, a Rust adapter over BRAN (`foley-crates/bran-media-evidence`). Red and green test receipts in `logs/*.receipt.json` |
| Demo (25) | The script above, built on `out/demo/9852/` and the census index. `npm run demo:offline` runs the whole pipeline offline from a fresh clone |

## Event rules to evidence

| Rule | How the repository meets it |
| --- | --- |
| The product's AI uses only `muse-ember-1.0` through the Meta Model API | `src/ember.mjs` holds the only network call; host and model are constants, and another model is refused before any connection (test `TC-R03-1` in `test/ember/`). `tools/check-public.mjs` lists the network hosts named in runtime source and fails on any other model provider |
| Total model spend at most $10 | $2.576656 in total ([`evidence/spend-summary.json`](evidence/spend-summary.json), from `node bin/foley.mjs spend`). `src/ember.mjs` stops at $9.00 and reserves each request's priced upper bound before it is sent |
| Only event work is demonstrated; prior work is identified | `vendor/bran/` is BRAN v0.4.0, unchanged at tag `baseline-bran-v0.4.0`; `git diff --exit-code baseline-bran-v0.4.0 -- vendor/bran` prints nothing. README "Prior work and event work" and [NOTICE](../NOTICE) |
| The repository is public | `node tools/check-public.mjs --tree .` and `gitleaks detect --no-banner --redact` pass before each push. Reporters' recordings are referenced by URL and SHA-256 only and are never committed |
| Prompt and token trace | [`trace/9852/`](../trace/9852/): `summary.json` (7 calls, 14,280 input and 23,478 output tokens, $0.013285), `calls.json` (each kept request, with images as SHA-256 digests) and `replies.json` (each validated reply). It records 9852 run 12, an earlier verified run of the same pair. The demo run is run 18. Raw prompts in `out/prompts/` are never published |
| Setup steps | README "Reproduce", run from a fresh clone (`logs/S7-RETURN.md`) |
