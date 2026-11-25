# W3R group R product return: run integrity

Outcome: **PASS**.

- Role: Implementer, wave-3 review repair, group R.
- Date: 2026-11-25. Observer for all results below: the group R Implementer.
- Head when this return was written: `0af787f`.
- No live model call, no real network call, no push.

## Findings, root causes and fixes

Each finding was checked against the code before it was changed. None was
wrong.

| Finding | Root cause (one line) | Fix commits | Proving tests | Prevention |
| --- | --- | --- | --- | --- |
| W3-01 | A PID file plus dead-owner takeover was not an atomic ownership transition | `dc25530` | TC-R09-4/run-exclusive | Kernel `flock` held by a child process for the whole run; the lock inode is never unlinked; any failure to lock refuses |
| W3-02 | `run` and `backlog` had different completion authorities, and `run` kept no attempt count | `4bbfe8a`, `aa0677f`, `94248ef` (see note) | TC-R09-1/cross-command-resume, TC-R09-2/attempt-limit | One journal, `state.json`, used by both commands through `runOne` and `backlog` |
| W3-03 | Stage attribution was a trace-length difference plus a separate append after the Ember transaction | `6fb156b`, `aa0677f`, `94248ef` | TC-R13-3/booked-recovery, TC-R13-3/settled-recovery | The case and stage are written on each Ember call record inside the ledger transaction; all spend is rebuilt from those records |
| W3-08 | `run.json` was published as finished before the export completed, and a report exception was committed as a stage result | `4bbfe8a`, `94248ef`, `d15afa5` | TC-INT-1/finalization-recovery, TC-R09-1/report-error-not-complete | `completion.json` is written last, after a passing core-proof check; a throwing stage is never committed |
| W3-09 | The core-proof check accepted any nonempty, digest-consistent manifest | `194957e`, `1dd7ab2` | TC-R15-4/complete-proof-semantics; TC-R15-4 (group a) still passes | Shared `requiredArtifacts` inventory; exact trace; identity and proof semantics checked |
| W3-13 | Repro kept actions in memory until it returned | `a946f26`, `94248ef` | TC-R14-2/incremental-actions | Repro calls an optional progress hook after each capture; the run republishes |
| W3-14 | Early terminal misses exported inside the stage, before the backlog recorded and published the outcome | `4bbfe8a`, `94248ef` | TC-R09-1/early-miss-census | Census published before the first request; the journal records and publishes the terminal status, then calls the idempotent export |
| W3-15 | The recording was copied before it was checked; cached media were read in full before any size check; audio extraction errors escaped as exceptions | `bb12f47`, `3104fc5`, `aa0677f` | TC-R04-2/integrated-recording-refusal, TC-R04-2/recording-content-and-size, TC-R04-2/audio-extraction-refusal, TC-R04-2/cache-size-before-read | The watch check (`inspect`) runs before any copy or hash; digests are streamed; the copy must match the checked digest |
| W3-16 | Only HEAD was compared with the revision, and a saved run was reused by issue number alone | `94248ef`, `4bbfe8a` | TC-INT-1/dirty-target-refusal, TC-INT-1/resume-input-identity | Tracked-clean check on the target and fixed target; the journal is bound to revision, recording digest, runner and fixture mode |

Note on `94248ef`: that commit is group P's W3-04 commit. While I was
working, group P staged the whole `src/run.mjs`, so it also contains my
uncommitted pipeline rewrite: the journal wiring, call-record spend,
completion marker, progress publication, recording and identity checks. The
content is intact in HEAD. My commit `aa0677f` therefore changed only
`bin/foley.mjs`. History was not rewritten, because rebase is not permitted.

## Changed paths

- Group R paths: `src/run.mjs`, `src/backlog.mjs`, `bin/foley.mjs` (run and
  backlog commands), `src/run-schema.mjs` (core-proof part),
  `changelog.d/wave-3.md`, this file.
- Other groups' files, each changed only for lines the fix cannot avoid, each
  in its own small commit:
  - `src/ember.mjs` (`6fb156b`, plus two complexity markers in `d15afa5`):
    the reservation stores an optional stage, and settle, booked and recovery
    events carry `caseId` and `stage`. This is required so that the call
    association is written in the same transaction as the spend.
  - `src/repro.mjs` (`a946f26`): an optional `onProgress` hook, called after
    each capture.
  - `src/watch.mjs` (`bb12f47`, `3104fc5`): `inspect` is exported for the
    preflight, and an audio extraction failure returns `refused_input`.

## Commands and exit codes

The gates ran with `FOLEY_OFFLINE=1` and `CARGO_BUILD_JOBS=4`, holding one of
the two shared gate slots, on the tree at `1dbff2e` and later. Logs are in
`out/w3r-rp/`.

| Command | Exit | Result |
| --- | --- | --- |
| `node --test --test-reporter=tap --test-concurrency=1 test/w3r/R-run.test.mjs test/w3r/R-artifacts.test.mjs` (head `0af787f`) | 0 | 16/16 |
| `node tools/red-receipt.mjs --green out/w3r-rp/R-green.log --same-ids logs/W3R-R-red.receipt.json` | 0 | "all 16 red ids pass" |
| `node tools/repeat.mjs 5 --test-concurrency=1 test/w3r/R-run.test.mjs test/w3r/R-artifacts.test.mjs` | 0 | 5/5 runs, 16/16 each |
| `node tools/concurrent2.mjs --test-concurrency=1 test/w3r/R-run.test.mjs test/w3r/R-artifacts.test.mjs` | 0 | 2/2 copies, 16/16 each |
| `node --test test/ember/` | 0 | 50/50 |
| Group a: `node --test test/stages/watch test/stages/report test/stages/backlog test/stages/score test/stages/schema` | 0 | 11/11 |
| Group b: `node --test test/stages/locate`; `cargo test --manifest-path foley-crates/bran-media-evidence/Cargo.toml` | 0; 0 | 2/2; 2/2 |
| Group c: `node --test test/stages/repro test/stages/predicate test/stages/prove --test-concurrency=1` | 0 | 9/9 |
| Group c: `node tools/repeat.mjs 5 test/stages/repro`; `node tools/concurrent2.mjs test/stages/repro` | 0; 0 | 5/5; 2/2 |
| Group u: `npm run build:ui && node --test test/ui/` | 0 | 4/4 |
| Group u: `node tools/repeat.mjs 5 test/ui`; `node tools/concurrent2.mjs test/ui` | 0; 0 | 5/5; 2/2 |
| `node --test test/e2e/` | 0 | 2/2 |
| `node --test test/s4x/*.test.mjs` | 0 | 6/6 |
| `npm run demo:offline` | 0 | `issue 1: proof_verified`; `replay.html: 0 requests besides the page file; 0 console errors`; run and spend exit 0 |
| `node tools/check-public.mjs --tree .` | 0 | 429 files, 0 findings |
| `az-lint --changed main` | 0 | cargo-fmt, clippy, shellcheck, shfmt, biome (55 files), gitleaks, semgrep (advisory, 0 findings) pass |
| `az-simplicity --changed main --format json` (advisory) | 0 | 61 findings in the tree. In group R's files and the lines changed in other groups' files: none. The only finding left in a touched file is `src/ember.mjs:132` (`prepare`), which predates this change. Accepted lengths are marked with `biome-ignore` and a reason |

No earlier suite regressed, and no check was weakened to close a finding.
The group a TC-R15-4 fixture still returns `ok` under the stricter
`checkCoreProof`.

## Failure states of what changed

| State | Handling |
| --- | --- |
| Crash while holding the lock | The kernel releases the `flock` when the holder's pipe closes. A stopped (paused) owner keeps the lock, so a second command refuses, which is the fail-closed behaviour |
| Two commands at once | Only one obtains the `flock`; the other exits 2 with `run_active` before any request (TC-R09-4) |
| Crash between the journal start record and commit | The attempt is counted. The stage runs at most once more, and a third visit records `attempted_miss` without a request (TC-R09-2). An open Ember reservation stays booked |
| Crash after the Ember settle, before the caller resumes | The call record already carries its case and stage, so spend is rebuilt on the next invocation (TC-R13-3/settled-recovery) |
| Crash during a request | A recovery event with its case and stage keeps the reservation booked and attributed (TC-R13-3/booked-recovery) |
| Crash during the final export | No `completion.json` exists, so the next invocation repeats the export without model calls (TC-INT-1/finalization-recovery) |
| Report or export failure | The stage is not committed and the command exits 3. No marker and no `proof_verified` (TC-R09-1/report-error-not-complete) |
| Stage file edited after its stage | Trace compaction refuses: no core proof and no marker |
| Retry or duplicate invocation | A complete issue makes no stage call. Spend projections are rebuilt from the call records, so they are idempotent (checked in both TC-R13-3 cases) |
| Changed inputs on resume | `resume_mismatch` (exit 2) before any write to the run folder (TC-INT-1/resume-input-identity) |
| Recording replaced between check and copy | The copy's digest must equal the checked digest; otherwise the copy is removed and the stage fails |

## Tests believed wrong

None.

## Remaining risks

- The journal and run documents use write-then-rename without `fsync`. That
  covers process crashes, not power loss.
- The repro progress hook republishes `run.json` on every capture. That costs
  one extra file write per action.
- `src/ember.mjs:132` (`prepare`) has a complexity finding that predates this
  change.

Blocker: none.
