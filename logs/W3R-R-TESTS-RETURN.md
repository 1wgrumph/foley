# W3 run integrity test evidence

**Outcome: PASS** — all nine run-integrity findings have effective regression
coverage. This is a test evidence result, not whole-wave acceptance or live-readiness approval.

- Unfixed product pin: `d7b86761f4d20085ae8927161e13d853e979321c`.
- Repaired product pin: `aa0677f4e10ce70a055474fcb4de5e27b2431ce6`.
- Shared branch head before return: `c23e8b757da99f63ead9757ef320ad6536f5c1a9`.
- Test content commit: `025092d`; receipt formatting commit: `8a237be`.
- Interface commits (before test content): `9b7cd89`, `41b8b3d`.
- Both product snapshots were assembled with `git show <pin>:<path>` under
  `out/w3r-r-pinned/` and `out/w3r-r-fixed/`; neither changed shared source.
  UI built with `node ui/build.mjs` and adapter built with
  `cargo build --offline --quiet --manifest-path foley-crates/bran-media-evidence/Cargo.toml`
  in each snapshot, exits 0. The vendor source was unchanged.
- Raw execution logs are retained under `out/`, not in the candidate tree.
  The committed `logs/W3R-R-red.receipt.json` binds the 16 IDs to the unfixed TAP log.

## Coverage and observed red

| Finding | SEIT ID | Test suffix | Assertion on unfixed product |
|---|---|---|---|
| W3-01 | TC-R09-4 | run-exclusive | Actual OS lock probe acquired the lock (exit 0 instead of contention exit 1) while the CLI was waiting on a real request. |
| W3-02 | TC-R09-1 | cross-command-resume | Backlog repeated watch after run committed it; resume directions produced `[true,false]`, not `[true,true]`. |
| W3-02 | TC-R09-2 | attempt-limit | Three transmitted requests after two interrupted stage visits; limit is two. |
| W3-03 | TC-R13-3 | booked-recovery | Run, backlog row and watch summary each reported 11 micro-USD, not 2442 including the booked reservation. |
| W3-03 | TC-R13-3 | settled-recovery | Each projection reported 11 micro-USD, not 22 including the call committed before the crash. |
| W3-08 | TC-INT-1 | finalization-recovery | Resume trusted finished run.json; replay.html, core-proof.json and completion.json still absent. |
| W3-08 | TC-R09-1 | report-error-not-complete | Backlog reported proof_verified despite failure publishing comment.md. |
| W3-09 | TC-R15-4 | complete-proof-semantics | All nine inconsistent synthetic artifact variants were accepted: inventory, verdict, predicate, stages, observed, identity, runner, fixture, trace. The unmodified complete fixture passed first. |
| W3-13 | TC-R14-2 | incremental-actions | Executed Archive action absent from run.json while a subsequent repro reply was held. |
| W3-14 | TC-R09-1 | early-miss-census | No census before request; exported DOM had one row instead of both input rows. |
| W3-15 | TC-R04-2 | integrated-recording-refusal | Invalid declared type copied; renderer failed with CLI exit 3 instead of refusal exit 2. |
| W3-15 | TC-R04-2 | recording-content-and-size | Both damaged MP4 and oversized recording copied; exits 1 rather than 2. Direct outside-tree path still refused. |
| W3-15 | TC-R04-2 | audio-extraction-refusal | Actual audio extraction operation failed; CLI exited 3 instead of recording a typed attempted miss (1). |
| W3-15 | TC-R04-2 | cache-size-before-read | Oversized cache object read in full, and dry run exited 0 instead of refusal exit 2. |
| W3-16 | TC-INT-1 | dirty-target-refusal | Dirty tracked source accepted by dry run (exit 0 rather than 2). |
| W3-16 | TC-INT-1 | resume-input-identity | Changed clip digest, runner, fixture flag and clean target revision each silently reused issue (four exits 1, expected four exits 2). |

Source inspection confirmed each failure: PID-file acquisition/recovery rather
than a kernel lock; separate run/backlog stage state; spend attribution after the
ledger transaction; report artifact publication after a finished run; hash-only
manifest check; in-memory action accumulation; late census publication; recording
copy or cache read preceding input validation; HEAD-only pinning and numeric
issue reuse. The new tests exercise those actual public paths. Earlier stage and
renderer tests did not collectively reach these interruption and boundary cases.

## Test inputs and execution

- Existing owned archive fixture and fixed fixture; the real Chromium page was
  captured before and after Archive, and asserted `Not archived`. FFmpeg encoded
  the two frames to a local MP4, with the same archive steps and regression code
  as TC-INT-1 (`fixtures/stages/archive-steps.json`,
  `fixtures/stages/generated-test.mjs.txt`). The audio case added an actual AAC
  stream, verified by ffprobe, then faulted only the external audio extraction.
- Actual independent CLI children, real loopback app, actual ledger, local
  isolated test runner, actual static/live browser DOM and owned temporary roots.
  Test I/O controls consist of scripted external replies and deterministic
  barriers at the HTTP arrival, ledger-lock release, and final run publication.
  The process group is killed at a barrier, never after a fixed delay.
- The size input uses the existing 50 MiB bound plus one byte, without any
  downloaded media. The proof controls vary only synthetic fixture artifacts.
- Full read observations include synchronous, asynchronous, and unbounded stream
  reads of the specific oversized test cache object. No external endpoint used.
- Initial diagnostic run: 13 intended assertion failures and one test defect
  (the browser helper does not return its callback result). Corrected the
  callback capture and verified all 16 final cases fail by assertion, not import,
  timeout, or hang. No skipped or cancelled cases.
- Red and green use the identical test content and ID list. Each sequential
  red/green run and both copies are separately checked by the receipt validator.

## Commands, exits, counts and digests

All local suite commands below ran in the indicated immutable product snapshot.
The new cases use `node --test --test-concurrency=1 --test-reporter=tap test/w3r/R-*.test.mjs`.
For every red log, `node tools/red-receipt.mjs LOG --expect-ids test/w3r/R.ids.txt` exited 0.
For every green log, `node tools/red-receipt.mjs --green LOG --same-ids ../W3R-R-red.receipt.json` exited 0.
Five sequential runs on the unfixed pin took 18.6–20.0 s each; repaired pin 20.0–24.6 s. Each two-copy run had identical results. All 7 red repeat/copy logs had the same 16 assertion messages as the primary receipt.

| Pin / log (under `out/`) | Test exit | Result | Log SHA-256 |
|---|---:|---|---|
| `W3R-R-red.log` | 1 | 16/16 intended failures | `5a354b5682609f866cb897069d62a7827c48e5e6d6aed5bb2fb0404ce6fb61fb` |
| `w3r-r-repeat-1.log` | 1 | 16/16 intended failures | `6c16ac12a09ee3bbe170a3731183dcd3ebf56f42b5bef8e30aea53d4e4c6711c` |
| `w3r-r-repeat-2.log` | 1 | 16/16 intended failures | `7bd645baa8eead7eb2fe1640427a108601750386b26a0c00d5fb7d5829e836d1` |
| `w3r-r-repeat-3.log` | 1 | 16/16 intended failures | `3ac616793e9185154b7889e78e1b6609a80a2734d6218e5e03ad3e7e3b0f5604` |
| `w3r-r-repeat-4.log` | 1 | 16/16 intended failures | `eed19ea66bc5515a5107d3688586678a00de898d6702b42153cd72d10dc5d5af` |
| `w3r-r-repeat-5.log` | 1 | 16/16 intended failures | `8b732afb75371a3c8c164aab5b088722b67ed442e9e6cb5ef12ddbf31dea7a95` |
| `w3r-r-copy-1.log` | 1 | 16/16 intended failures | `91eea9ae12baa1176b029b84973f1ec9155db818d81ed16933ba65942c2a1e3e` |
| `w3r-r-copy-2.log` | 1 | 16/16 intended failures | `76569057a5ca604d6c27f9a261ee2ea4c0055057b555bf6cadcd57356cdb0f90` |
| `w3r-r-green-1.log` | 0 | 16/16 passed | `ca06cfebd15898b182c56416c9f9bce0d271af2519ef24c8e8b9c3a8cfec3807` |
| `w3r-r-green-2.log` | 0 | 16/16 passed | `4d2fd1663eac206fb1aad4b0c4eabc23dcef769d55a77b65f44845ed8835e13f` |
| `w3r-r-green-3.log` | 0 | 16/16 passed | `52d30fa6f0933c287f31e8ebec1d42174b79d7fffd7e97cd048ddedd5e447d3f` |
| `w3r-r-green-4.log` | 0 | 16/16 passed | `1d85ad660c46aed1767c419666c8e5939b679f96346a2561b53e017ec333eac3` |
| `w3r-r-green-5.log` | 0 | 16/16 passed | `f4b0925d9150c61f4ece58f34a01237d741eabb11146521d4e8edacca2b7ff81` |
| `w3r-r-green-copy-1.log` | 0 | 16/16 passed | `687104d59a85f1d58b54fbea37907abd86e5bd45cdd1e74ed4777c1f6947186e` |
| `w3r-r-green-copy-2.log` | 0 | 16/16 passed | `6c2c0b29744a805831a1825d1d5c0b39f04fdffa12e40bc4ed91c55759078499` |
| `w3r-r-candidate-1.log` | 0 | 16/16 passed (shared tree) | `8ce2b8bbdf899d4a7c6a31fb51ef29337216595f1c85adb4db5cb46629f90b0b` |
| `w3r-r-candidate-latest.log` | 0 | 16/16 passed (shared tree) | `2a629cefa8dda3e17ab1e976c9d737864eea3f33c2435d2f02acc5c3daaaf951` |

Existing suite gates: all passed on both immutable pins. Zero failed, skipped or cancelled Node cases.

| Command | Count on each pin / exit | Unfixed log SHA-256 | Repaired log SHA-256 |
|---|---|---|---|
| `node --test test/ember/` | 50/50, 0 | `da2b0919d6385a35ddc4a99fde6c1b7a318cbdb10bbea40bc7b6036db423068f` | `2cd2c530ae08421adeaccb9f39710fdfcf012ccf8b89d8f97a31587bf55e15eb` |
| `node --test test/stages/watch test/stages/report test/stages/backlog test/stages/score test/stages/schema` | 11/11, 0 | `061d7c9071783d292ad9bc8c5e20fa6ea17401ffe4e3d9c77b2b571ee3ccff59` | `25413aa64a331092ac7cda9bafe4a6e7a810073fd82fb73998308f492296fcbf` |
| `node --test test/stages/locate` | 2/2, 0 | `a45d2dc1ad2d4e2d78721206795a1239d92246568df4f381c6af703be812ebd5` | `d16a6b69113ece4937b9e72b9c5bfe9c0ff6430c12cbe5a649b0a6464312abd9` |
| `node --test --test-concurrency=1 test/stages/repro test/stages/predicate test/stages/prove` | 9/9, 0 | `ccf93ae38fdc1870f891a9f96c3e738b51deb67ad0c3fc18fda2af5d41c1c11a` | `49ee0469a40c7773a8f4fee75be56369259d71f48e8cbd35ecf273984e3b2040` |
| `node --test test/ui/` | 4/4, 0 | `589c102c3387b05011491518aad8bb1bb966835768c17f5f0fb3cfb5181f9489` | `d339da96fdb5f050dab00b0c55152ac2b7d425c993355325ceaba412b3be985c` |
| `node --test test/e2e/` | 2/2, 0 | `dd4217d0ab3a2c239ea970ce4bbb4915844984460124ae49ce16be96a907818f` | `c1c0886df9e13366e161ff000d0834f481ac6f10cf61c752babd89bcf7532ce6` |
| `node --test test/s4x/*.test.mjs` | 6/6, 0 | `b9db99c4d353ec420e3f48b2f29a435ab314ad514c60b2134118b9cc2606e42b` | `ee05a35e169136b0a4cb04655db076867f8f4dbcf10604bbc1319792276f9f30` |
| `cargo test --offline --manifest-path foley-crates/bran-media-evidence/Cargo.toml` | 2/2, 0 | `4af137772128d4e8544bc697bc88a3a85e5d5d742bcac6935a8470ff44c5f4f4` | `2ae2d6316165074ddbf811ef4244c970fcf86ea264c09a8aa34c5a6e018f7fcc` |

`FOLEY_OFFLINE=1 node tools/demo-offline.mjs` on unfixed pin: exit 0, proof_verified, 33 micro-USD synthetic settled, zero booked, no secondary replay requests or console errors. Log SHA-256 `a2422291bf9f0b62b83c049013bb39697194890189a542b37b7b9b70c62d6032`.

Vendor gate: the independent review ran the same pinned vendor fast gate, exit 0, 613 passed, 6 ignored; SHA-256 `dd127137012c6ce19f7147ab7f5bbda1a4d8ff848aea4ca1deef00df5ae62ca6`. `git diff --exit-code d7b8676 -- vendor/bran` exited 0. Upstream vendor fast gate evidence is inherited, not a new rerun.

Shared-tree verification:

| Command | Exit | Result | Log SHA-256 |
|---|---:|---|---|
| `node tools/check-public.mjs --tree .` | 0 | 424 files, 0 findings | `84b873ab30596799fdafa9a91666d192d9afceee06d0f1c433c3ca10695c347b` |
| `az-lint --changed main` | 1 | other in-progress file: ui/render.mjs formatting | `934ac84e9784577e952eef261eca4f417e259af2b9dd9b3342eb1b4ba73950d2` |
| `az-lint --changed main` | 1 | same in-progress ui/render.mjs formatting | `6eb305654438bc6e294624b118336feaee4ddc1c10b1544e58542332f833c8be` |
| `az-lint --changed main` | 0 | all applicable gates pass; Semgrep advisory 103 files, 0 findings | `f427c81d0e0d7afaf2d9bea8712fa89817041a74acd66066cc5b0c3c26494b1a` |
| `biome check test/w3r/R-*.mjs logs/W3R-R-red.receipt.json` | 1 | receipt indentation only | `a3a1594c95daf6a672ac99c71bba636f1f95cf349baecf093a61267efbd06b0e` |
| `biome check test/w3r/R-*.mjs logs/W3R-R-red.receipt.json` | 0 | 5 files, 0 findings | `31289202270e72d0259d84e3c74c9a6dbb8f2c26c2f68cd6e0079b5ca06de2a7` |

The receipt indentation was fixed without changing its IDs or underlying red-log digest. No other group's files were edited.

## Changed paths

- `logs/W3R-R-INTERFACE.md`
- `test/w3r/R-artifacts.test.mjs`
- `test/w3r/R-barrier.mjs`
- `test/w3r/R-run.test.mjs`
- `test/w3r/R-support.mjs`
- `test/w3r/R.ids.txt`
- `logs/W3R-R-red.receipt.json`
- `logs/W3R-R-TESTS-RETURN.md`

## Remaining boundary

No blocker for this test evidence. Native BRAN repository discovery was unavailable (no policy file); ordinary source discovery and the actual adapter test passed. No live model, real-issue proof, upstream publication, or broader containment assurance was attempted. The green snapshots and shared-tree samples do not establish acceptance of other findings or future commits.
