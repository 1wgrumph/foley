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
