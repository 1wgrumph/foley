### Added

- Preflight slice S1a. `tools/preflight-tools.sh` checks every external tool
  and writes `out/preflight/tools.json` with versions and SHA-256 hashes.
  `tools/target-pin.sh` pins, builds and starts excalidraw/excalidraw at commit
  `eaa7fa32a6645ae9da57eda548e838d0e2a024a1` and records the result in
  `fixtures/target.json`. `tools/check-public.mjs` checks the public boundary,
  with one synthetic fixture per forbidden class under
  `fixtures/public-negative/`.
- `package.json` pins Playwright 1.65.1 and `@axe-core/playwright` 4.14.1.
- `media/PROVENANCE.json` records the one vendored BRAN image.
- `.gitleaks.toml` and `.gitleaksignore` exempt the seeded fixtures and one
  synthetic test literal in vendored BRAN.
