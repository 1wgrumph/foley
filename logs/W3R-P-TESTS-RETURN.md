# W3R-P regression return

**Outcome: REPAIRABLE_FAILURE.** Test delivery complete for all behavioral findings, but the repaired candidate still accepts proof without a usable fixed-page oracle. W3-18 also has a literal behavioral-red contract gap: the previous policies were equivalent. No passing red receipt is fabricated for that structural finding.

- Head before this return: `59d7fa66590501e284d17c1bba71eaa05bdc7f83`.
- Both interfaces committed first at `4b4d9f6`. Proof regression commits: `72af7cc`, `99cd53f`, `59d7fa6` (plus intermediate receipt `0af787f`).
- Changed paths: `logs/W3R-P-INTERFACE.md`, `test/w3r/P.test.mjs`, `test/w3r/P-native.test.mjs.txt`, `test/w3r/P.ids.txt`, `logs/W3R-P-red.receipt.json`, `test/s4x/ui.test.mjs`, and this return.
- Pinned red candidate: `d7b8676`, copied from Git blobs without changing the shared source. All generated materials and target copies stay in ignored output directories.

## Evidence and oracle

- Target checkout HEAD matched the committed pin, `eaa7fa32a6645ae9da57eda548e838d0e2a024a1`. Copy the exact tracked source via Git archive and the installed root/workspace dependencies and built app into `out/w3r-excalidraw`. The test can also use a prepared copy specified by FOLEY_EXCALIDRAW_TARGET. No target checkout mutation.
- The real runner reports Vitest 3.0.6. A hand-written known-good angle conversion test passed using the target-native configuration in a network namespace. The same test is then submitted through the ordinary offline proof contract; the repaired isolation path reports runner exit 0 and does not certify it as a failure.
- The pinned production page has two canvases and no dev/test hook. An actual rectangle drawing action produces committed scene type rectangle and app-state active tool selection. The real-build regression checks both values and the false control. The synthetic page matches the pinned test hook's data shape; it is a separate fast control, not a replacement for the real build.
- The owned archive app is the predicate oracle for the proof tests. Both unrelated-build controls retain the same broken transition; one unrelated label uses the same values, so matching runner output alone cannot prove provenance. A fixed build with an unavailable page cannot establish the expected observation.
- The existing input-boundary explanation tests reject an inert credential-shaped sentinel. Extended the existing display test to require the same refusal on disk-loaded run data; neither test claims historical behavioral red for W3-18. Structural inspection confirms `hasCredentialShape` in `src/text-safety.mjs`, called at both boundaries.

## Pinned red gate

| Finding | Test ID | Assertion failure on pinned candidate |
| --- | --- | --- |
| W3-04 | TC-R07-1/native-vitest | Unsupported runner; no successful runner result |
| W3-05 | TC-R07-2/no-independent-control | Verified despite no fixed build/control |
| W3-05 | TC-R07-2/unrelated-build-difference | Verified for an unrelated theme difference |
| W3-05 | TC-R07-2/predicate-provenance | Verified for unrelated label despite same broken Archive transition |
| W3-05 | TC-R07-2/unavailable-fixed-oracle | Verified though fixed page lacks the observable control |
| W3-06 | TC-R06-4/discriminated-predicate | Invalid and unsupported scalar predicates accepted |
| W3-06 | TC-R06-4/page-oracles | Unsupported checks do not report actual DOM, console, or scene state |
| W3-06 | TC-R06-4/target-canvas-state | Unsupported checks do not read the real app's committed scene/state |
| W3-06 | TC-R06-4/console-recording | No console-error reproduction result |
| W3-06 | TC-R04-1/unsupported-watch-predicate | Unsupported predicate recorded with ok instead of malformed_output |
| W3-06 | TC-R06-5/no-paid-reproduction | Null and unsupported predicates consume a request and raise instead of typed miss |
| W3-07 | TC-R06-3/whole-turn | Malformed turns execute actions or consume additional requests instead of stopping |
| W3-17 | TC-R04-5/evidence-bounds | Invalid timestamp, length, array count and text type accepted |
| W3-17 | TC-R04-5/evidence-replay | Steps/run/embedded replay, comment and visible notes omit evidence |
| W3-18 | Existing TC-R06-3/observation and TC-R14-1/observation | Compatibility control passes on both candidates; structural gap, not a false red |

All 14 new cases fail with ERR_ASSERTION, zero skips or cancelled cases. Red repeat: 70/70 same assertion results in five runs. Two-copy: 28/28 same results. All child exits 1, no signal. See `W3R-P-red.receipt.json` for digests.

## Commands and receipts

Original unchanged-product suites are identical to the pinned gates in [W3R-L-TESTS-RETURN.md](W3R-L-TESTS-RETURN.md): Ember 50, stages 22, UI 4, E2E 2, S4x 6, crate 2, vendor 613 passes and 6 ignored. All original suite exits 0 after correcting the vendor scratch Git-root setup. Re-ran S4x after the compatibility extension.

| Command | Exit | Count/result | SHA-256 |
| --- | ---: | --- | --- |
| `node --test test/w3r/P.test.mjs (pinned)` | 1 | 14/14 assertion red | `2c6ad150b38c7a0e697ad937e8f5e55460e2951d86994e7c2f9c19686693c66c` |
| `node tools/repeat.mjs 5 test/w3r/P.test.mjs (pinned)` | 1 | 70/70 assertion red | `0e86169e95bc1136870414b633b80b963907002f51c3beeba006e137b947d7eb` |
| `node tools/concurrent2.mjs test/w3r/P.test.mjs (pinned)` | 1 | 28/28 assertion red | `dd3d7136ada1dbdda3edb9e30596d10b0ecd65c76ccf9819338a29a8f078ea73` |
| `unshare -Urn -- env -i PATH=/usr/bin:/bin node node_modules/vitest/vitest.mjs run regression.test.mjs --cache=false --reporter=tap-flat --no-color --maxWorkers=1 --minWorkers=1` | 0 | 1/1 known-good native control | `df541fd1b8a9bf48af8999c37d5e3b85756e4db5f4e839df44edff0cd0b2da08` |
| `Pinned preview and Playwright drawing/control` | 0 | Actual scene and app state observed; hook absent | `6f7dcbadb8e37c5a713ad796f5412c456065106e8136ac5f20f8683f5d39d971` |
| `node --test test/s4x/*.test.mjs (pinned, extended)` | 0 | 6/6 | `f69c760b9151014f878dcf2dd05d561c0dc803e4eb44dedbe8e8ddfe35ad51d2` |
| `node tools/repeat.mjs 5 test/s4x/ui.test.mjs (pinned)` | 0 | 10/10 | `e239ddea9b56d20a1c787a58d532dd03cc709ff62e910fafa5b70a9c3353f586` |
| `node tools/concurrent2.mjs test/s4x/ui.test.mjs (pinned)` | 0 | 4/4 | `97e6adaec9736cad18cb6db8b746ac21c5ce7d1164bd7e80e34b92ffa20ae43f` |
| `node --test test/s4x/*.test.mjs (repaired)` | 0 | 6/6 | `68af8df2a82597bea382af45f3a1a62262018f623240558b9c42a054bd6780bf` |
| `node --test --test-concurrency=1 test/stages/index.js (repaired)` | 0 | 22/22 | `ebe059c4566740cfc11d6917d3cd126633f1acf29bddc4d6a69f6cee20b2fafe` |
| `node --test test/w3r/P.test.mjs (repaired)` | 1 | 13/14, one residual oracle failure | `b0224b5fece9a6aae8a60ee95ba5a2569d87560c02c667c1212f21f5b40c51b0` |
| `node --test --test-name-pattern=unavailable-fixed-oracle test/w3r/P.test.mjs (repaired)` | 1 | 1/1 failure, verified instead of not_verified | `612e75d697e85876c5599aa7965dafa444d18a1acd3b30e94fc96b1ee40b69cf` |
| `node --test test/w3r/L.test.mjs (integrated source)` | 0 | 10/10 | `9fb7b030cefc396109102fba31d690b3f29c97c978c7cc47bf79bd8df7902b7a` |
| `node tools/check-public.mjs --tree .` | 0 | 429 files, zero findings | `e42c9d1bdcf7e690c8e10cdaea5ba716da371300720706d093c7860141bfe847` |
| `az-lint --changed main` | 0 | Fmt, clippy, shellcheck, shfmt, Biome, Gitleaks pass; Semgrep advisory zero findings | `381d98a2e01f3d0acb3a69aa010275abbb6ca859584826ba5b73c0d2e32cf07b` |

## Remaining obligations

- W3-05: independent fixed control must positively observe the expected value rather than count missing observation as a success. The regression remains red on the repaired shared candidate. Product repair is outside test-only authority; do not weaken the test.
- W3-18: the no-behavior-change deduplication is verified structurally and by compatibility controls, not a behavioral assertion failure on the old source. This is a contract gap in the literal requirement that every finding produce a behavioral red. The two boundary cases have no regressions.
- No live calls, credential reads, target edits, product-code edits, or publication. Native repository discovery was unavailable; ordinary Git inspection and real executable fixtures used. Native Vitest evidence exercises benign code only; not exhaustive containment assurance.
