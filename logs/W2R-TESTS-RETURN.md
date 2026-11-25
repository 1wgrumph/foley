# W2 test repair return

**Outcome: PASS (Test Implementer).** All 34 added regressions failed on the reviewed product for their intended assertion, then passed on the repaired product. The complete suite has 50 tests; the original 16 SEIT IDs remain unchanged. No product code was edited by this assignment.

Verified head before this return: `4f24ef3`. Final test commit: `959cb47`. Product subject for the red gate: `6c1f040` (SHA-256 `abc031a305fcec3b3c0ac08d6d03248336ab8238916274aed4d47ef93284a3e9`). Green subject: `4f24ef3` (SHA-256 `5228807f485725e9066166ab71498a369cd78b30d32c60088f82ab63bf7eb06a`). Both subjects were copied without editing the shared product file into ignored scratch roots. This return does not change executable code.

## Changed paths

- `logs/W2R-INTERFACE.md` — committed first at `ca99938`; precise environment, wire, digest, event and recovery contract.
- `test/ember-harness.mjs` — shared setup extracted from the original suite; caller-observable assertions and isolated process, storage and network controls.
- `test/ember/index.js` — original 16 IDs, generated domains, exact wire ceiling, retry barrier, request/recovery assertions; imports the new regressions for the directory gate.
- `test/ember/repair.js`, `test/ember/repair-ids.txt` — 34 distinct SEIT-mapped repair regressions.
- `test/fake-server.mjs`, `fixtures/ember/worker.mjs` — exact wire capture, scripted reply content, real process crash barrier, independent redirect observation.
- `tools/red-receipt.mjs` — accept SEIT suffix IDs without relaxing the assertion, exact-ID, or non-skip checks.
- `logs/W2R-red.receipt.json`, `logs/W2R-TESTS-RETURN.md` — final receipts and handoff.

Test commits: `ca99938`, `ca6a2e2`, `12c41a2`, `959cb47`. Product commits, including the W2-11 documentation repair, belong to the Product Implementer.

## Verification commands and receipts

Node v22.23.4. All network exchanges were with an ephemeral loopback HTTP server; simulated live targets were intercepted and routed to that server. The guard captures the original redirect option before enforcing network isolation. Only synthetic credentials were used. No provider credential file was read. No new dependency.

| Command | Exit | Result / SHA-256 of retained output |
|---|---:|---|
| `FOLEY_OFFLINE=1 node --test test/ember/` (pinned red scratch) | 1 | 50 tests: 44 assertion failures, six original positive cases pass, no skipped/cancelled. `ec2930b260125c3036fea979e327ccb8a71888a088c106bad582464a8348e443` |
| `FOLEY_OFFLINE=1 node --test test/ember/repair.js` (pinned red scratch) | 1 | 34/34 assert red; `6d85088aeeef4083d7737ea4bc807a3c254d0740625f1d456f2733d91420e263` |
| `node tools/red-receipt.mjs out/w2r-new-red.log --expect-ids test/ember/repair-ids.txt` | 0 | 34 exact assertion IDs, committed receipt SHA-256 `2e0282742f4b32ab91e51e5dfdfed761369c58c4fe531d8376b2b991fd238adc` |
| `FOLEY_OFFLINE=1 node --test test/ember/` (green scratch) | 0 | 50/50 pass, no skipped/cancelled; 4.130 s; `f2472b39ac677f5d5f93359cf33de50b705c2562f5fcc42c67ac940fe72cd45b` |
| `node tools/red-receipt.mjs --green out/w2r-green-repeat-1.log --same-ids logs/W2R-red.receipt.json` | 0 | Every red ID passes; first green repeat digest below. |
| `node tools/check-public.mjs --tree .` | 0 | 328 files, zero findings; `25cb0ed3b338633811c280a2e32e927eb1729ecd8972037c531a5d87b24da960` |
| `az-lint --changed main` | 0 | Biome clean, secret scan clean, Semgrep local rules zero findings; `f5cb2fbc27a08cd63652deaca251de866e1e51369343778fa77e01dfff4f9297` |
| `az-simplicity --changed main --format json` (workspace-installed tool, advisory) | 0 | 11 advisories; `d66bdc1f7f07b39e9915fcda8245be32f3aaf8b39c0ef8624916dea51ff6c972` |

The red subject was verified by `git show 6c1f040:src/ember.mjs` into scratch. All 34 new cases were rerun five consecutive times and two copies at once on **both** subjects. Each red run exited 1 and its receipt checker exited 0; each green run and same-ID checker exited 0. All red assertion texts matched after normalizing the allocated local port only. No hangs, skips, cancellations, or import failures.

| Run | Red log SHA-256 | Green log SHA-256 |
|---|---|---|
| 1 | `9a268cd2756e7c7eba8bb25a8baf7669d7b67ecf75fca95c6679908fdd4b046d` | `9e66dcf591a62467ce558feda7e77f02ca10254157f17e70bd3406f470413e24` |
| 2 | `69f2a1ce90953315b6c68a49b2210b528f65a2ced735a2ff5fb65411a1cec4b9` | `f199b2a7256d160423c07cd0311d64fa88935f816508252d8d600b32a150ebb0` |
| 3 | `045f4d29f0db2022687c6d8dff6db615a8432ed27cb13d661186a8a12449606d` | `451530132839cc8c1afe08b032479b94095c9897d1b2791cf70bc4607cfc128c` |
| 4 | `d21bb0a87e6143b5ebe8c40ca5f54e66289650a1e254ba50cdd47db7a0354145` | `00e0239886b61bf46e8fc265e2059b19586183b635a5e74322570e82f25da552` |
| 5 | `be5d25bbd9ff5cca3d106af894f8e112f718c55438ee540cb5adb9e94aef6cee` | `2520e4cd4e77776a3f8103329d731dbb2f08fb7395c230eb92880a256a216aa0` |
| Parallel A | `d7d0d2867767f9976e3c9f325f5988df3f7fdef37cf83ef646ca889d93def324` | `0e0ebb0c25bf4f8e4d568229678031dda1690e322870fcf4503d63e3c320d784` |
| Parallel B | `f8367933368bd3e6d06d2790d753a923a32c5440809d25bd2a8983f36395d082` | `389c1a736ccec91fa8c10eaeb0da97cd6d6deca1fb20a113f81650c230acd78d` |

All raw logs and mutated subjects remain under ignored `out/`. Three isolated negative controls prove the test-only repairs distinguish correct behavior from omissions. Each uses a separate copy of the pinned product, not an actual product change.

| Command (in mutation scratch) | Mutation | Exit / observed assertion | SHA-256 |
|---|---|---|---|
| `FOLEY_OFFLINE=1 node --test --test-name-pattern '^TC-R03-1$' test/ember/` | Omit product redirect policy | 1; Product omitted redirect error policy | `5b10246b8523ebd45ef98f86628277277c5d2c1112bf3ede290d4f1474788269` |
| Same command | Omit output ceiling from wire | 1; missing max_completion_tokens field | `56c606b2869575e2fba2b1e30ced79383afe157216045636f67f520f23e76496` |
| `FOLEY_OFFLINE=1 node --test --test-name-pattern '^TC-R01-10$' test/ember/` | Skip requested retry delay | 1; Retry ignored Retry-After | `982a11f45b85904fc070349df024422a7b5de279bcdd7a7c2c566484380fdc89` |

## Finding-to-regression evidence

All new IDs are red by `ERR_ASSERTION` on the pinned subject and green on the repaired subject.

| Finding | SEIT | Test name | Observed red reason |
|---|---|---|---|
| W2-01 | TC-R01-2 | TC-R01-2/bound-violation | Later call returned ok rather than budget_refused after actual cost 1300 exceeded reservation; full-cost assertion already passed. |
| W2-01 | TC-R01-1 | TC-R01-1/wire-framing | ok instead of budget_refused at one micro-dollar over the framed bound. |
| W2-01 | TC-R01-8 | TC-R01-8/unbounded-image | Unbounded image admitted. |
| W2-01 | TC-R01-8 | TC-R01-8/frame-dimensions | Oversized frame admitted. |
| W2-02 | TC-R01-2 | TC-R01-2/first-snapshot | First send used caller mutation. |
| W2-02 | TC-R01-10 | TC-R01-10/retry-snapshot | Retry used caller mutation. |
| W2-03 | TC-R12-1 | TC-R12-1/success-credential | Credential in result. |
| W2-03 | TC-R12-1 | TC-R12-1/usage-credential | Credential persisted in output files. |
| W2-03 | TC-R12-1 | TC-R12-1/prompt-credential | Credential persisted in output files. |
| W2-03 | TC-R12-1 | TC-R12-1/case-credential | Credential persisted in output files. |
| W2-03 | TC-R03-1 | TC-R03-1/literal-loopback | Client attempted a non-test destination (localhost; intercepted before network). |
| W2-03 | TC-R03-1 | TC-R03-1/offline-key | ok instead of refused_input with only live credential present. |
| W2-03 | TC-R12-1 | TC-R12-1/usage-numeric-domain | ok instead of malformed_output on a nonnumeric reasoning count. |
| W2-04 | TC-R01-6 | TC-R01-6/baseline-append | Committed baseline event lost: 0 instead of 1. |
| W2-04 | TC-R01-6 | TC-R01-6/request-append | Missing original request event after append failure: 1 instead of 2. |
| W2-04 | TC-R01-6 | TC-R01-6/refusal-append | Missing refusal after append failure: 0 instead of 1. |
| W2-04 | TC-R01-6 | TC-R01-6/truncated-tail | Truncated tail not repaired. |
| W2-05 | TC-R01-5 | TC-R01-5/kill-in-lock | Crash lost original request event: 1 instead of 2. |
| W2-05 | TC-R01-4 | TC-R01-4/settlement-lock | Settlement lock failure reported success. |
| W2-05 | TC-R01-5 | TC-R01-5/reused-owner | Live reused PID hid prior liability. |
| W2-06 | TC-R02-2 | TC-R02-2/concurrent-refusal | Last trace running total differs from ledger: 0 instead of 2. |
| W2-06 | TC-R02-2 | TC-R02-2/fresh-refusal | First refusal missing trace directory. |
| W2-07 | TC-R01-12 | TC-R01-12/case-domain | ok instead of ledger_unreadable for malformed numeric case entry. |
| W2-07 | TC-R01-12 | TC-R01-12/reservation-domain | ok instead of ledger_unreadable with bad reservation case ID. |
| W2-07 | TC-R01-11 | TC-R01-11/own-case-key | Second request returned ok instead of budget_refused for inherited case name. |
| W2-08 | TC-R12-1 | TC-R12-1/reply-content-types | ok instead of malformed_output for null JSON content. |
| W2-08 | TC-R12-1 | TC-R12-1/prompt-storage | Public call threw instead of returning a closed result. |
| W2-08 | TC-R12-1 | TC-R12-1/lock-create | Public call threw instead of returning a closed result. |
| W2-08 | TC-R12-1 | TC-R12-1/lock-acquire | Public call threw instead of returning a closed result. |
| W2-08 | TC-R12-1 | TC-R12-1/reserve-storage | Public call threw instead of returning a closed result. |
| W2-08 | TC-R12-1 | TC-R12-1/settle-storage | threw instead of ledger_unreadable; booked spend preserved. |
| W2-08 | TC-R12-1 | TC-R12-1/lock-release | threw instead of ledger_unreadable after settlement. |
| W2-08 | TC-R12-1 | TC-R12-1/out-storage | Public call threw instead of returning a closed result. |
| W2-08 | TC-R12-1 | TC-R12-1/settle-read | ok instead of ledger_unreadable on unreadable ledger at settlement. |
| W2-09 | TC-R01-1 | TC-R01-1 (extended) | Generated cap+1 admitted; wire comparison catches omitted ceiling in negative control. |
| W2-09 | TC-R01-3 | TC-R01-3 (extended) | Concurrent admission over cap (sent vs refused). |
| W2-09 | TC-R01-10 | TC-R01-10 (extended) | Pinned reservation omitted framing; isolated no-wait mutation fails Retry ignored Retry-After. |
| W2-10 | TC-R02-2 | TC-R02-2 (extended) | Pinned reservation 39990 vs 40000; generated sequence also verifies trace conservation after each event. |
| W2-10 | TC-R03-1 | TC-R03-1 (extended) | Unmodified redirect policy is correct; mutation fails Product omitted redirect error policy. |
| W2-10 | TC-R01-6 | TC-R01-6 (extended) | ok instead of ledger_unreadable on trace storage failure; repaired case also verifies recovered request metadata. |

The other original red IDs are TC-R01-2, TC-R01-5, TC-R01-7, TC-R01-8 and TC-R01-11: each fails the corrected framing-aware cap or exact reservation oracle, not import or setup. Original TC-R01-4, TC-R01-9, TC-R01-12, TC-R02-1, TC-R03-1 and TC-R12-1 remain positive on the pinned product. Test-only fixes legitimately preserve correct product behavior; the isolated omission controls establish the missing negative evidence.

## Test design and repair disposition

- Origin: W2-01 to W2-08 were introduced by S2; W2-09 and W2-10 by S2T. Escape: fixed examples and missing negative controls. Repeated process, storage and wire regressions now bind the named finding to the observed caller result, real filesystem, and captured HTTP request. No private product function is called.
- Generated domain uses fixed seeds 0xF01 (nine cap/accounting cases at equality and one micro-dollar either side), 0xF03 (six controlled in-flight races), and 0xF02 (four five-event sequences). The fake server holds responses until admission is observed. Retry delay uses a controllable clock barrier, not elapsed wall time.
- Usage and response fixtures extend the committed chat envelope from the original suite; malformed values are deliberate negative stimuli from the review. Trace failures use real isolated files, controlled filesystem operation failure, and a worker killed after its ledger rename while holding the lock. These are product-boundary faults, not fake-server self-tests. A dead lock remains fail-closed and only the test-owned stale lock is quarantined before recovery.
- Corrections during authoring: fixed a reversed generated cap-gap sign detected on the first repaired snapshot (49/50); reran identical corrected tests against both subjects. Formatting and lint were corrected and all final repeats rerun. No remaining wrong-reason red.
- Simplicity advisories were inspected: shared scenario/worker cleanup and test-server dispatch are inherited large functions; preserving isolated resource teardown and a single real HTTP fixture is preferable to abstraction churn. The two extended sequence tests are long because they contain both negative and positive proof. Product advisories do not belong to this test write set. The advisory command exited 0.
- BRAN unavailable: no native policy found. Used ordinary repository discovery; no BRAN coverage claimed.

## Remaining risks / blocker

- Live provider framing, media token tier, output-limit enforcement and usage bounds remain unverified; S3 must establish those before a live-readiness claim. Offline passing tests do not prove a live upper bound. The test uses the selected chat wire field and synthetic usage.
- Process-death recovery is tested; machine power-loss durability is not. For settlement that cannot take the lock, the test proves a typed miss and exact booked recovery, not a known-usage settlement without the lock.
- Node 22 only; no Node 20 matrix. No independent assurance or code-review result claimed by this test author.
- W2-11 is documentation outside this test objective; a separate product commit corrected it. No push, publication, or other remote action.

**Blocker: none for this assigned test packet.**
