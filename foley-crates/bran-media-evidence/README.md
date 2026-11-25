# bran-media-evidence

Event-built during the Foley hackathon (not part of BRAN). This crate maps a
`foley.steps/1` document to ranked file and line anchors (`foley.anchors/1`).
It calls the BRAN v0.4.0 library, vendored unchanged under `vendor/bran`, for
the repository scan and graph query. It makes no network call and never runs
target repository content.

```sh
cargo run --manifest-path foley-crates/bran-media-evidence/Cargo.toml -- \
  --repo <repo-dir> --steps <steps.json>
```
