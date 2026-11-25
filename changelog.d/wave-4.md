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
