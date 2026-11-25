### Added

- Locate slice S4b. New event-built crate
  `foley-crates/bran-media-evidence` maps `foley.steps/1` to ranked
  `foley.anchors/1` file and line anchors. It calls the vendored BRAN v0.4.0
  library (repository scanner and graph query) and leaves `vendor/bran`
  unchanged. `src/locate.mjs` runs its binary, checks every anchor against the
  pinned target revision, refuses paths that leave the target tree and writes
  `anchors.json` atomically. No model call and no network socket.
