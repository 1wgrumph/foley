# W3R-L regression return

**Outcome: PASS (test delivery).** All five findings have reproducible behavioral red cases on the unchanged candidate. This is not implementation acceptance.

- Head before this return: `4bbfe8a58b9af38c8a22404bbcedfb8d1add3579`.
- Interface commit: `4b4d9f6`; tests and red receipt: `6d10731`.
- Changed paths: `logs/W3R-L-INTERFACE.md`, `test/w3r/L.test.mjs`, `test/w3r/L.ids.txt`, `logs/W3R-L-red.receipt.json`, `fixtures/public-negative/assignment-metadata/logs/seed-RETURN.md`, and this return.
- Pinned source copied file-by-file with Git blob reads at `d7b8676`; dependencies already installed, builds offline. No shared source edit.
- Input evidence: existing owned clip, steps, frozen split membership, fixture app, actual BRAN binary, actual ledger calls to loopback; Node version control substitutes only the older version-command output (current runtime returns the same vMAJOR.MINOR.PATCH format). Synthetic metadata has no actual assigned values.

## Red evidence

| Finding | Test ID | Assertion failure on pinned candidate |
| --- | --- | --- |
| W3-10 | TC-R05-1/graph-tie | Lexical file a.mjs precedes zArchive.mjs despite graph name match |
| W3-20 | TC-R05-1/json-number-grammar | Accepted 01, -01, 1., -.5 and 1.e2 |
| W3-11 | TC-R10-1/eval-population | Tuning success contributes 0.5 instead of 0 |
| W3-11 | TC-R10-2/eval-split | Substituted tuning label exits 0 instead of 2 |
| W3-11 | TC-R10-3/eval-execution | Zero instead of one selected offline request |
| W3-11 | TC-R10-3/envelope-ledger | Exhausted envelope gives unknown-option outcome, not budget outcome |
| W3-11 | TC-R10-3/envelope-ceilings | Missing typed budget refusal for all three over-ceiling flags |
| W3-12 | TC-R11-1/return-metadata | Seeded metadata exits 0 instead of 1 |
| W3-19 | TC-R13-1/node-minimum | Advertised >=20 instead of >=22.12.0 |
| W3-19 | TC-R13-1/node-preflight | Does not diagnose older Node |

All 10 failures use ERR_ASSERTION. `node --test test/w3r/L.test.mjs` exits 1, 10/10 red. `node tools/repeat.mjs 5 test/w3r/L.test.mjs` exits 1 (expected), 50/50 same assertions, no signal. `node tools/concurrent2.mjs test/w3r/L.test.mjs` exits 1 (expected), 20/20 same assertions, no signal. Digests in the red receipt.

## Original and shared-tree gates

| Command | Exit | Receipt/count | SHA-256 |
| --- | ---: | --- | --- |
| `node --test test/ember/` | 0 | 50/50 | `4fc93cbc1a203b74e90de37d6f0b9c8737c5d2db1c325197f6637cf6e804ae5a` |
| `node --test --test-concurrency=1 test/stages/index.js` | 0 | 22/22 | `692faef77b153af52b9b15e20ef9b810538ff7862c87782a27d9c76216d7759a` |
| `node --test test/ui/` | 0 | 4/4 | `cf0c4479e5adb6a89e9640356129a10503158ed3bda65cb686e762526ba5771a` |
| `node --test test/e2e/` | 0 | 2/2 | `444eaaaea5c74c4c8c11d07c821f4b71871d3e81be1311831568facbef8bd71b` |
| `node --test test/s4x/*.test.mjs` | 0 | 6/6 | `805fd98518e6ba59ade9abf394c125a17b5e1362cb80f6c26db3c2daafcc1597` |
| `cargo test --offline --manifest-path foley-crates/bran-media-evidence/Cargo.toml` | 0 | 2/2 | `9dde87cfa7da04bb38a43f1a6957caebd1088fa99afd8cc2573c826a6225f3b1` |
| `vendor/bran/tools/ci/check.sh --fast` | 1 | initial scratch parent-root lint failure | `5f6b94840c48bd9019d8be33f7c06bd2baa174f37331e06bbe9041660ba9566b` |
| `vendor fast gate, isolated Git root` | 2 | scratch base ref absent | `f37f6d3aa0f414f16907a0d174afdb136a9acb1504850e607b13dd5497d46f07` |
| `vendor fast gate, isolated Git root and valid base` | 0 | 613 passed, 6 ignored; fast gate passed | `d0d80a5cd4cbd5bd49dd18dcb93b740770496c7f7321a6d021b5f18fe8299457` |
| `node tools/check-public.mjs --tree .` | 0 | 420 files, zero findings (check predates metadata repair) | `0aba8553a488977d20279c23c7451e6d8c061d5803cf50dd422defc9d50ac19b` |
| `az-lint --changed main` | 1 | 2 format errors in concurrent product files | `6312781904c2667632650cb779d1994cb099a627d80e277eb7053cc41b6b6345` |
| `npm run build:ui` (pinned) | 0 | Built | `9d3b0e8c578f5073962ab13ff52885e710cd95452e4f1cd65c33f4a9dbbd3190` |
| `node --test --test-name-pattern='graph-tie\|json-number\|eval-\|envelope-' test/w3r/L.test.mjs` (concurrent repaired source) | 0 | 7/7 | `a81e125875c2bf216352e18bd426f96a119dd047a669ad530e32a5447d766c98` |

Vendor retry corrected the scratch repository root and missing base reference; it used identical pinned vendor bytes. The vendor tag comparison exits 0. Original suites all pass.

Shared lint failure: formatting in `src/eval.mjs` and `ui/render.mjs`; warnings in other pre-existing files. Own file passes Biome. No edit to concurrent product files. The three final Node/public-boundary regressions await the corresponding product changes; their exact red evidence is preserved. No paid requests, no publication. Native repository discovery unavailable; ordinary Git inspection and actual adapter tests used.

Blocker: none for test delivery. Full integrated green and fresh shared-tree gate belong to the repaired candidate's verification.
