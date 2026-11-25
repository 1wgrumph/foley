### Added

- Locate slice S4b. New event-built crate
  `foley-crates/bran-media-evidence` maps `foley.steps/1` to ranked
  `foley.anchors/1` file and line anchors. It calls the vendored BRAN v0.4.0
  library (repository scanner and graph query) and leaves `vendor/bran`
  unchanged. `src/locate.mjs` runs its binary, checks every anchor against the
  pinned target revision, refuses paths that leave the target tree and writes
  `anchors.json` atomically. No model call and no network socket.
- Stage group a (S4a). `src/watch.mjs` checks a recording's type, size and
  duration before any request, samples frames with ffmpeg (1 fps, at most 40,
  at most 1280 px), and tries bounded video only when the probe or
  `fixtures/ember/bounds.json` allows it. Model replies must pass
  `validateSteps`. `src/backlog.mjs` runs a dated census serially and resumes
  without repeating a finished stage. `src/report.mjs` writes the draft comment
  with untrusted text in code spans. `src/score.mjs` computes the evaluation
  quantities. `src/run-schema.mjs` validates steps and run documents, writes the
  reconciled spend summary and checks core-proof artifact digests.
