# S4a stage group a: return

Author: the S4a Implementer. Dates: 2026-11-24 to 2026-11-25. Branch `wave-3`. Planned slice, not a defect fix.

## Outcome: PASS

The group a gate passes on the final head: 11 tests, 11 pass. I edited no test, fixture or test
tool. The other groups' modules are not needed for this gate. Nothing was pushed, and no real
network call was made.

## Head and changed paths

The head is the commit that adds this return. My changed paths are:
- `src/watch.mjs`, `src/report.mjs`, `src/backlog.mjs`, `src/score.mjs`, `src/run-schema.mjs`
  (818 lines in total);
- `changelog.d/wave-3.md` (one appended entry);
- `logs/S4a-RETURN.md`.

I did not change `package.json`; its working-tree change belongs to another group. Scratch,
Git-ignored: `out/s4a-*`.

Commits:
- 072257b Add evaluation scoring (DES-FOL-R10)
- 8d9c6e3 Add draft comment report with untrusted text in code spans (DES-FOL-R08)
- 6bd20c7 Add run schema, spend summary and core-proof check
- 8b1693d Add watch stage: recording checks, frames path, steps validation
- dc69f95 Add resumable serial backlog runner (DES-FOL-R09)
- 2c65c9d Split backlog row rules and watch helpers out of the main flows
- the changelog and return commit

## Commands and exit codes

| Command | Exit | Result |
| --- | --- | --- |
| `FOLEY_OFFLINE=1 node --test test/stages/watch test/stages/report test/stages/backlog test/stages/score test/stages/schema` | 0 | 11 tests, 11 pass, 0 fail, 0 cancelled, 0 skipped |
| `node tools/red-receipt.mjs --green out/s4a-green.log --same-ids out/s4a-red-subset.receipt.json` | 0 | "green receipt: all 11 red ids pass". The subset holds the 11 group-a ids from `logs/red-s4.receipt.json`, all of which fail in the committed red log. |
| The same green check against the full `logs/red-s4.receipt.json` | 1 | `11 !== 26`. The tool requires an exact count, and the 26-id receipt covers all five groups, hence the derived subset. |
| Seeded control: copy in `out/s4a-seeded/` whose backlog reruns every stage, TC-R09-1 | 1 | Fails, because re-running finished stages sends extra requests and spends again. Shown twice: once at the per-issue cost assertion, once at the all-`proof_verified` assertion. |
| Gate, five runs in a row | 0 ×5 | 11/11 each, 1 to 2 s, no hang |
| Gate, two copies at the same time | 0, 0 | 11/11 each |
| `node tools/check-public.mjs --tree .` | 0 | 386 files, 0 findings; runtime hosts: `api.meta.ai` |
| `az-lint --changed main` | 1 | Failures are only in other groups' files: shellcheck and shfmt on `tools/isolate.sh`; biome on `test/e2e/index.js`, `test/ui/*` and `ui/render.mjs`. `biome check` on my five files passes. gitleaks PASS, semgrep advisory 0. |
| `az-simplicity --changed main --format json` (advisory) | 0 | 0 open findings in group a files. One accepted finding is marked in code: `watch` at 52 lines (limit 50), with `// biome-ignore lint/complexity/noExcessiveLinesPerFunction`. Biome reports that marker as an unused-suppression warning (exit 0). |

## Acceptance to evidence

| # | Acceptance item | Evidence |
| --- | --- | --- |
| 1 | Every SEIT case bound to CMD-UNIT for group a passes under its own id, with a green receipt | TC-R04-1, TC-R04-2, TC-R04-6, TC-R08-1, TC-R09-1 to TC-R09-4, TC-R10-1, TC-R13-3 and TC-R15-4 pass. Subset green receipt exit 0. |
| 2 | Trust boundaries, each with a passing negative test | Media input: TC-R04-2 refuses wrong type, over 50 MB, over 120 s and unreadable media, all with zero requests. Model output: TC-R04-1 returns `malformed_output` for schema-invalid steps. Upstream text: TC-R08-1 report; issue and model text appear only inside code spans and are never executed. Edited artifacts: TC-R15-4 returns `digest_mismatch`. Ledger mismatch: TC-R13-3 refuses to write a summary. |
| 3 | No request leaves loopback | `withEmber` asserts no other destination and the redirect error policy on every model call, and the backlog worker loads `loopback-only.mjs`. ffprobe and ffmpeg get only `PATH` in their environment and `-protocol_whitelist file` with `file:` inputs. |
| 4 | Other groups' modules are not needed | Group a imports only `src/ember.mjs` (through the tests) and its own files. The gate passes no matter what state the other groups' modules are in. |

## Failure states (money, files, processes)

| State | Handling |
| --- | --- |
| Crash during a Watch model call | The Ember ledger keeps the reservation booked (W2 governor). `steps.json` is written by temp file and rename, so it is either absent or complete. |
| Video refused, then frames | The frames attempt is a separate Ember call with its own reservation, under the same `caseBudget`. No other retry exists. |
| ffprobe or ffmpeg hangs or fails | Each run has a timeout (30 s or 120 s). A failure gives `refused_input` before any request. The temporary frame folder is removed in `finally`. A process crash can leave it in the OS temp folder: no money and no repository effect. |
| Backlog crash before a stage finishes | The stage is marked started (`attempts`) before it runs, so on resume it runs once more. A second interruption gives `attempted_miss` with no third run. |
| Backlog crash after a stage, before saving | The stage reruns once, within the same rule. Any spend stays booked or settled in the Ember ledger, never released. |
| Torn or corrupt state | State files are written by temp file and rename. Every state is validated before any stage runs, and a corrupt one refuses the whole run (TC-R09-1). |
| A stage throws | Recorded as status `error`. A gating stage (watch or repro) then gives `attempted_miss`. |
| Concurrent backlog processes on one `runRoot` | Not prevented here: one scheduler per `runRoot` is an operator rule. The $9.00 cap still holds through the Ember ledger lock. The worst case is duplicate stage spend inside the cap. |
| Serial processing | Every stage is awaited in order. The next issue's request starts only after the previous reply (TC-R09-4). |
| Spend summary taken during a live call | Trace deltas do not match the ledger, so `writeSpendSummary` throws before writing (TC-R13-3 mismatch case). |
| Core-proof artifact outside the run folder, missing or edited | Rejected lexically, then through `realpath` against symlink escape; any digest or trace mismatch gives `digest_mismatch`. |
| Timeouts on model calls | Ember's `timeoutMs` default (120 s) applies, and `timeout` is a typed miss. |

## Code-simplicity return

There was nothing to reuse except `ACTIONS` and `STATUSES`, which `run-schema.mjs` exports once
for watch and backlog; no earlier module did these jobs. Standard library only.

New abstractions, each with one reason:
- `inspect` (media trust boundary);
- `sampleFrames` and `framesContent` (frames path);
- `audioParts` (bounded narration rule);
- `steps` (drops every undeclared reply field);
- `saveSteps` (atomic write);
- `runIssue`, `runnable` and `settled` (backlog resume and row rules);
- `insideRun` (shared run-folder path rule).

Kept under "Never cut": media checks before sending, reply schema validation, the run-folder path
rule, and fail-closed refusal of corrupt state or ledger mismatch.

## Tests I believe are wrong

None.

## Amendments

- 2026-11-24: `writeSpendSummary` and `checkCoreProof` live in `src/run-schema.mjs`, because
  TC-R13-3 and TC-R15-4 import them from there; there is no `src/spend.mjs`.
- 2026-11-25: The green receipt for group a uses a derived subset of `logs/red-s4.receipt.json`
  (same red log digest, 11 ids), because `tools/red-receipt.mjs` requires an exact count.
- 2026-11-24: `validateSteps` accepts any non-empty predicate `kind` with scalar `expected` and
  `observed`. Group c owns the predicate kinds.

## Remaining risks

1. **The video and audio paths are not covered by the governor.** They are used only when the
   probe or `fixtures/ember/bounds.json` marks them bounded, and the current Ember client refuses
   them, so live runs take the frames path until S3 and a governor update land.
2. **Real recordings are untested.** The Watch prompt is checked only against the fake server's
   scripted replies; how well the model extracts steps from real recordings is unmeasured.
3. **Concurrent backlogs on one run folder are an operator rule, not enforced.**
4. **Stage spend attribution needs `stage-spend.jsonl`.** No stage writes that file yet, so
   `per_stage` stays empty for real Ember traces until one does.
5. **az-lint fails on other groups' files**; their owners must fix those before the wave gate.

## Blocker

None.
