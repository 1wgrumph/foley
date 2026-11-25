# S4T return

## Outcome

PASS. All 28 assigned SEIT cases have one stable test ID. The exact
CMD-RED-S4 command produced 26 stage/UI assertion failures. A separate
E2E receipt covers the other two IDs. Both receipt commands exited 0;
there were no import, syntax, timeout, skip or cancellation failures.
The red assertion is that the corresponding product entry does not
exist yet. It is not evidence that the future product passes.

Candidate test and interface commit:
`5622ac834876260f266e916d266bd9271be60caa` on `wave-3`, based on
`6c1f040`. This return is added in the subsequent evidence commit.

The five group contracts are in [S4T-INTERFACE.md](S4T-INTERFACE.md).
The stage groups require only their own modules and the existing Ember
client; the integrated tests intentionally require all groups. No
product code, dependency, lockfile, vendor source or plan file changed.
No push, credential read, paid call or external network call occurred.

## Changed paths and commits

| Commit | Paths |
| --- | --- |
| `8e8308c` | `fixtures/app/`, `fixtures/app-fixed/`, `fixtures/stages/`, `test/fake-server.mjs`, `test/stages/support.mjs`, `test/ui/support.mjs` |
| `54f994f` | `tools/repeat.mjs`, `tools/concurrent2.mjs`, `tools/test-process.mjs` |
| `89ec950` | `test/stages/watch/`, `report/`, `backlog/`, `score/`, `schema/` |
| `18811b3` | `test/stages/locate/`, `foley-crates/bran-media-evidence/tests/contract.rs` |
| `268435e` | `test/stages/repro/`, `predicate/`, `prove/` |
| `d53a001` | `test/ui/index.js`, `test/e2e/`, `test/stages/index.js`, `test/stages/ids.txt` |
| `5adc169` | `logs/S4T-INTERFACE.md`, `logs/red-s4.receipt.json`, `logs/red-s4-e2e.receipt.json` |
| `5622ac8` | Bind backlog and score tests to committed census/held-out schemas; refresh both receipts |
| Record S4T return | `logs/S4T-RETURN.md` |

The ignored raw logs, installed pinned dependencies and reference
scripts under `out/` remain local. The reference browser script is
`out/s4t-reference.mjs`; the trivial tool control is
`out/s4t-trivial.test.mjs`. No Git identity was written to configuration.

## Commands and exit codes

| Command | Exit | Evidence |
| --- | ---: | --- |
| `npm ci --offline --ignore-scripts --no-audit --no-fund` | 0 | Installed the existing four locked packages from cache only; Playwright 1.65.1 and axe 4.14.1 |
| Chromium launch/version control | 0 | Chromium 159.0.8154.6, local browser available |
| `node --test test/stages/ test/ui/ > logs/red-s4.log; test $? -ne 0 && node tools/red-receipt.mjs logs/red-s4.log --expect-ids test/stages/ids.txt` | 0 | Runner 1; 26/26 assertions, receipt 0 |
| `node --test test/e2e/ > logs/red-s4-e2e.log; test $? -ne 0 && node tools/red-receipt.mjs logs/red-s4-e2e.log --expect-ids test/e2e/ids.txt` | 0 | Runner 1; 2/2 assertions, receipt 0 |
| `node --test fixtures/ember/import-failure.mjs > logs/s4t-import-failure.log` | 1 | Intentional import failure |
| `node tools/red-receipt.mjs logs/s4t-import-failure.log --expect-ids fixtures/ember/import-failure.ids.txt` | 1 | Expected rejection |
| `node out/s4t-reference.mjs app` | 1 | Actual Chromium Archive click observed Not archived; archive-status assertion failed |
| `node out/s4t-reference.mjs app-fixed` | 0 | Same click observed Archived; expected assertion passed |
| Trusted generated-test fixture run with `node --test regression.test.mjs` in unique copies | 1, 0 | Same archive-status test red on bug, green on fixed; control exited 0 |
| `node tools/repeat.mjs 5 out/s4t-trivial.test.mjs` | 0 | 5/5 passed |
| `node tools/concurrent2.mjs out/s4t-trivial.test.mjs` | 0 | 2/2 passed |
| `node tools/repeat.mjs 5 --test-name-pattern='^TC-R06-1$' test/stages/repro` | 1 | Expected. Five child exits 1, no signals, each exactly one ERR_ASSERTION for missing repro module |
| `node tools/concurrent2.mjs --test-name-pattern='^TC-R06-1$' test/stages/repro` | 1 | Expected. Both child exits 1, no signals; same assertion |
| `node test/fake-server.mjs` | 0 | Ten scripted requests passed |
| `FOLEY_OFFLINE=1 node --test test/ember/` | 0 | All 16 S2 cases still green after extending fake replies |
| Fixture/support smoke (pinned Git snapshot, ffmpeg/ffprobe overlong clip, real Ember and protocol adapter) | 0 | Valid pinned snapshot; duration >120s; two loopback requests, settled 11 micro-dollars |
| Axe missing-alt and file-URL controls | 0 | Missing alt caused image-alt violation; file URL was recorded |
| Axe contrast measurement control | 0 | Measured contrast 9.73:1 and explicit axe data available for 4.5:1 threshold |
| `unshare -Urn true` | 0 | Host supports isolated network namespace |
| `FOLEY_OFFLINE=1 node --test test/stages/watch test/stages/report test/stages/backlog test/stages/score test/stages/schema` | 1 | 11 red tests, none cancelled |
| `node --test test/stages/locate` | 1 | 2 red tests |
| `node --test test/stages/repro test/stages/predicate test/stages/prove --test-concurrency=1` | 1 | 9 red tests |
| `node --test test/ui/` | 1 | 4 red tests |
| `rustfmt --edition 2021 foley-crates/bran-media-evidence/tests/contract.rs` | 0 | Formatted Rust integration test; no crate manifest yet |
| `node tools/check-public.mjs --tree .` | 0 | Zero findings; only approved runtime model host named |
| `az-lint --changed wave-2` | 0 | Biome and gitleaks pass, semgrep 0 findings |
| `az-simplicity --changed wave-2 --format json` | 2 | The base branch was removed between commands |
| `az-lint --changed 6c1f040` | 0 | Immutable packet base; Biome and gitleaks pass, semgrep 0 findings |
| `az-simplicity --changed 6c1f040 --format json` | 0 | 33 advisories, worst cognitive complexity 21 (limit 20), longest function 103 lines (limit 50), both in fake server |

The Rust linter and advisory Clippy skipped because no crate manifest
exists. The default BRAN policy is absent, so ordinary repository
discovery was used. Neither skip is a claim of Rust or BRAN verification.

### Evidence digests

SHA-256, all relative to repository root. The raw logs are ignored;
the receipt JSON files are committed.

| Path | SHA-256 |
| --- | --- |
| `logs/red-s4.log` | `d7a62df482ecabcf950562b8aeca5c890672642b2a89a262e44410a917bb5741` |
| `logs/red-s4.receipt.json` | `108ac822742f0621543acffd17a0b38642851cc889b25698f1bea0e335494192` |
| `logs/red-s4-e2e.log` | `2427eb8bdb481a8a32789ec1079f5bf8a034cbe9511bf305b7cb2a5b668c5cab` |
| `logs/red-s4-e2e.receipt.json` | `8cc4b55a3087a78626189b5c517209b297e62316bb3a8856f4620008c6803430` |
| `logs/s4t-import-failure.log` | `95c0233d8a561d826e08e86c755edde1a00b00dac7c69702fb331dfddbbcae93` |
| `logs/s4t-repeat-browser.log` | `a5fd4d20c3fa2dacd951011a55ff591ef30e8992722ddb97a33fd7cf5c5da56f` |
| `logs/s4t-concurrent-browser.log` | `20fb616a4fcdf997c4c09df659a76322dd35344366d2472c8770b5f80829df24` |
| `logs/s4t-reference-bug.log` | `0972294133e0899355847224607e2bdad14bb3fe64f1e13d9dfaa122100fda5f` |
| `logs/s4t-reference-fixed.log` | `703c4defc127b0b90abdf48a03923b84f9864aa56616c2a6fe5d2e5083806be3` |
| `logs/s4t-simplicity-pinned.log` | `4edbf067a35653e72a3e7bf185730d038d432e5321941bffbc1f19075eece7da` |
| `out/s4t-reference.mjs` | `7f58281674734a21487a99f8fbe2c6999207ea974c6ce0824d8b369928880f2a` |

## Acceptance-to-evidence

| Packet item | Evidence | Result |
| --- | --- | --- |
| 1. Assertion-only red receipts | CMD-RED-S4 and E2E receipt command | 26 + 2 assertion failures; both receipt checks exit 0; import-failure seed rejects |
| 2. Observable contracts | Both red commands; browser and runner references; interface note | Assertions address public exports, files, model transport, ledger, processes and DOM. No private helper is pinned. |
| 3. Model calls loopback only | Fake smoke, support smoke, S2 regression | Executed model calls use the loopback fake. Parent transport and isolated CLI test children have local-only guards. Future stage calls are not reached in red. |
| 4. Seeded bug/fixed browser fixture | `node out/s4t-reference.mjs app` and `app-fixed` | 1 and 0, same step and expected predicate |
| 5. Proof acceptance and isolation tests | TC-R07-1 through TC-R07-4, trusted fixture runner and unshare control | Test cases red; trusted candidate red/green verified. Actual generated-code containment must pass after implementation. |
| 6. Independent predicate and model-verdict negative | TC-R06-4 and TC-R06-5 | Red cases include false model success, fixed-app negative and context freshness. Actual mutation control belongs to the green gate. |
| 7. Shared machine reliability | Repeat and concurrent tools on trivial and browser cases | Trivial 5/5 and 2/2 pass; browser 5 + 2 expected red assertions, no hang. Ephemeral ports, unique roots, bounded readiness and cleanup. |
| 8. Exact five-group interfaces | `logs/S4T-INTERFACE.md` | Committed module, callable, file, CLI, trace, schema and Rust contracts |
| 9. Trust boundary negative tests | TC-R04-1/2, TC-R07-3/4, TC-R14-3/5; axe seed | Red cases cover media bounds, invalid output, sandbox denial, inert data rendering and read-only folder scope. Missing-alt axe seed verified separately. |

## SEIT mapping

Every name in the receipts is exactly the SEIT case ID.

| File | Cases |
| --- | --- |
| `test/stages/watch/index.js` | TC-R04-1, TC-R04-2, TC-R04-6 |
| `test/stages/locate/index.js` | TC-R05-1, TC-R05-2 |
| `foley-crates/bran-media-evidence/tests/contract.rs` | Additional library/CLI agreement evidence for TC-R05-1 |
| `test/stages/repro/index.js` | TC-R06-1, TC-R06-2, TC-R06-3, TC-R06-5 |
| `test/stages/predicate/index.js` | TC-R06-4 |
| `test/stages/prove/index.js` | TC-R07-1, TC-R07-2, TC-R07-3, TC-R07-4 |
| `test/stages/report/index.js` | TC-R08-1 |
| `test/stages/backlog/index.js` | TC-R09-1, TC-R09-2, TC-R09-3, TC-R09-4 |
| `test/stages/score/index.js` | TC-R10-1 |
| `test/stages/schema/index.js` | TC-R13-3, TC-R15-4 |
| `test/ui/index.js` | TC-R14-1, TC-R14-3, TC-R14-4, TC-R14-5 |
| `test/e2e/index.js` | TC-R14-2, TC-INT-1 |
| Both receipts and `tools/red-receipt.mjs` | TC-RED-2 |

## Amendments and corrections

- Census path: replace `fixtures/census.json` with
  `fixtures/census/census.json`. Status-set control reads that file.
- Held-out path: replace `fixtures/labels/held-out.json` with
  `fixtures/eval/held-out.json`. Split membership is checked; score
  arithmetic uses separate synthetic labels, not real held-out content.
- Clip path: replace `fixtures/clip/owned.mp4` with
  `fixtures/recordings/owned-basic-flow.mp4`. Ground truth is the
  adjacent truth JSON.
- The owned clip has no bug; allow a null predicate on that correct
  clip. The seeded Archive app supplies the actual failure predicate.
- S2 cannot price video/audio yet. The bounded-video Watch protocol
  control injects an Ember-compatible local HTTP adapter. Frame and
  other stage tests use actual Ember, preserving its budget ledger.
- CMD-RED-S4 is unchanged. The E2E amendment adds
  `test/e2e/ids.txt` and `logs/red-s4-e2e.receipt.json` so neither
  integrated case is omitted.
- The directory entry is `index.js`, matching the existing Node
  directory command behavior and preserving all individual stage
  entry commands.
- TC-R05 uses a pinned small owned Git snapshot, with a labelled
  archive logic file, rather than requiring the large target build.
  The actual BRAN library, adapter and network-denial checks still
  run in the green gate.
- The small archive app owns a Node test runner. The pinned real
  target's Vitest runner remains unchanged.
- TC-R13-3 exercises the schema group's spend operation independently.
  TC-INT-1 invokes CLI spend. Because S2 trace events do not carry
  stage names, accept a separate call-ID to stage attribution file.
- Record stage-local replay events in `replay.json`; the CLI composes
  them into final and live `run.json`.
- For the CMD-BROWSER model-verdict negative control, TC-R06-4 checks
  direct predicate observation and TC-R06-5 falsely claims success
  on the first attempt. A verdict-only mutant cannot satisfy both.
- The server wildcard negative tests a refused non-loopback bind
  configuration. Connecting to the wildcard address itself is not
  a reliable bind test on all systems.
- UI and sandbox boundary controls use inert markup-shaped strings
  and test-owned outside-file sentinels rather than OS files or real
  data. Model output remains untrusted.
- The axe control initially used a single-page browser convenience
  API, which the pinned axe library rejects. A browser context fixes
  that script defect; the context-based missing-alt control passes.
- The `wave-2` ref was removed during the advisory run. The prescribed
  command returned 2; reran against the packet's immutable base
  `6c1f040`, exit 0, without changing any branch.
- No plan files were changed. These lines record the interface/path
  amendments for the handoff.

## Simplicity disposition

Reused Node's runner, Playwright, existing Ember, fake server and
receipt checker. Only test-side abstractions were added:

- Shared scenario support owns temporary files, guarded synthetic
  transport and cleanup for multiple stage groups.
- The app server and archive fixture supply the same transition to
  browser, proof and integration cases.
- The stage callback fixture lets backlog run independently in both
  a parent and a crash-test child.
- Pinned fixture and child-process helpers provide observable Git
  provenance and readiness/exit evidence for locate and integration.
- UI support shares run data, browser lifetime and DOM/media checks
  between replay and end-to-end tests.
- The test-process tool shares bounded subprocess handling between
  repeat and two-copy concurrency.

The 33 simplicity advisories are nonblocking. The longest test
functions keep fault matrices and resource lifetimes within the
single required stable test ID; the fake server's dispatch covers
all scripted response types. No trust validation, isolation,
predicate oracle, accessibility check or cleanup was removed.

## Remaining risks and blocker

No blocker for this red test assignment. Actual stage green runs,
Rust compilation/BRAN query, model-drive isolation enforcement,
real UI screenshots/axe passes and full integrated replay still
require the product modules. The red browser repetitions reached
the intentional assertion, not the product browser loop. The
reference app and trusted runner prove the fixture oracle, not the
unimplemented stage. Synthetic transport fixtures are not evidence
of live provider protocol compatibility, video pricing or actual
held-out issue success. Those are separate planned obligations.
Use the pinned base when the old integration ref is absent.
