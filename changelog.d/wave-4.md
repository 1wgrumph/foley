### Added

- Documentation slice S7. `README.md` explains what Foley does, how Muse Ember
  is used and bounded, prior BRAN work against event work, setup, the offline
  demo, live runs, limits and credits. `docs/ARCHITECTURE.md` lists modules,
  data flow, run folder files, trust boundaries and closed result sets.
  `docs/SAFETY.md` describes the spend governor, the test sandbox, the browser
  origin lock, handling of reporters' recordings and refusals.
  `docs/SUBMISSION.md` maps the rubric and event rules to evidence. Results
  are marked `RESULT PENDING` until live runs are committed.
- Real bug pairs for the proof stage (S5p). `fixtures/pairs/pairs.json` records
  three closed Excalidraw bugs (#10840, #9852, #8418), each with the reporter's
  recording (URL and SHA-256 only), fix pull request, fix and bug commits,
  steps and predicate. `tools/build-pair.sh <issue>` builds both commits under
  `out/pairs/` with the frozen lockfile and scripts disabled, checks lockfile
  integrity, scans the dependency tree with ClamAV and fails on an unknown
  commit. `test/pairs/check.mjs` runs a hand-written Playwright check per pair;
  `test/pairs/prove-pair.mjs` runs each pair's known-good regression test
  through `prove` offline, and all three reach `verified`. Three proof fixes
  made that possible: the isolated Vitest run gets a home directory, `prove`
  takes the built page directories for its control (`pageDirs`), and a
  multi-line Vitest failure message counts as an assertion failure.
- Pointer actions and pair runs (S5w). Reproduction gains `pointer_click`,
  `pointer_double_click`, `pointer_move` and `pointer_drag`, which name integer
  pixels of the fixed 1280 by 720 viewport; the prompt states the viewport, a
  turn with any out-of-range coordinate is refused whole, and recorded steps
  and the page control accept the same actions. `foley run --pair <issue>`
  proves a real pair from `fixtures/pairs/pairs.json` and its build receipt,
  serving the bug build on loopback, refusing a missing build, a mismatched
  commit or recording, and binding the pair's commits into the journal, run
  document and core proof. All three real pairs reach `proof_verified` offline.
  Locate now reports only anchors in files tracked at the pinned revision.
- Live protocol probe (S3). The first paid calls confirmed the Ember chat
  endpoint, `max_completion_tokens` and the usage fields; the ledger's tokens
  and cost equal the API's usage on every call. Whole MP4 video is accepted
  (about 251 tokens per second, against about 1,200 per sampled frame), so the
  client now prices `video_url` parts from `fixtures/ember/bounds.json`; audio
  stays refused. Requests may carry a validated `reasoning_effort`, and Watch,
  reproduction and proof each set one, because at Ember's default effort a
  Watch reply spent its whole output limit on reasoning. The Watch prompt now
  asks for a target on every step and for the key in `key_press` steps. Watch
  sends frames rather than video, which missed two of eight actions on the
  owned clip.
- Computer-use pilot (S3b). The governor gains `callEmberComputer`, a
  stateless Responses API path for Ember's native computer tool, priced from
  the replayed history with each screenshot bounded as a frame. On the 9852
  flow both drivers reproduced the failure first time; the screenshot-and-action
  loop stays the reproduction driver.
- Live core proof attempts (S5). No pair reached `proof_verified` within three
  runs each; the live runs found and fixed these defects. Watch and proof now
  receive the issue title as data. Pointer steps must carry every field, and
  the prompt lists the app state a predicate can read. Reproduction lets the
  page settle before its check, because Excalidraw saves state on a debounce.
  Proof states the assertion format, names the failed rule after a malformed
  candidate, and receives the target's test notes (`test_notes` in
  `fixtures/pairs/pairs.json`). Every chat request asks for JSON mode.
- Live core proof (S5). Issue 9852 reached `proof_verified` live: Ember's test
  fails on the bug build and passes on the fixed build, also when rerun without
  Ember. Bounded in-product retries were added for model variance:
  - one re-ask on an invalid Watch reply or reproduction turn, naming the
    broken rule;
  - a rejection of predicates that hold before any action;
  - up to two extra Watch rounds with what reproduction saw, keeping a
    readable predicate;
  - a model-free check on the fixed build;
  - the reproducing actions handed to proof;
  - the failure check's live value on each turn;
  - the target's documented shortcuts as data.
- Evaluation and backlog (S6). Issue 9852 verified on 3 of 5 unchanged runs;
  the held-out set gave 1 failure observed of 8; the census backlog gave every
  one of 50 issues a status (36 attempted, 5 failures observed). The client
  now accepts a JSON reply after leading prose, and proof keeps going after a
  malformed reply. A redacted token trace of the verified run is in `trace/9852/`.
