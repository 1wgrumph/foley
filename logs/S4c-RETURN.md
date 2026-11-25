# S4c return: reproduction, predicate, proof

Outcome: **PASS**. Product head `1d83205` on `wave-3` (this return is
committed after it). Logs are local under `out/s4c/` (ignored by Git);
digests are listed below.

## Changed paths

| Path | Purpose |
| --- | --- |
| `src/predicate.mjs` | `checkPredicate(page, predicate)`; `visible_text` only (the one kind with a current caller) |
| `src/repro.mjs` | `repro(...)`: scripted or observe-act loop, at most 3 attempts in fresh contexts, origin lock, declared action set, `replay.json` |
| `src/prove.mjs` | `prove(...)`: at most 4 candidate rounds, isolated runs on bug and fixed copies, rerun without a model call, `proof.json` |
| `tools/isolate.sh` | Sandbox: user, mount, PID and network namespaces; empty environment; tmpfs work copy; hidden home, temp and runtime-socket directories; Node permission model; data-segment and heap limits; kill backstop |
| `changelog.d/wave-3.md` | Appended the S4c entry |

No edit under `test/`, `fixtures/`, test tools, `vendor/bran/` or the plan
directory. No `package.json` change and no new dependency.

## Commands

| Command | Exit | Result |
| --- | --- | --- |
| `node --test test/stages/repro test/stages/predicate test/stages/prove --test-concurrency=1 && node tools/repeat.mjs 5 test/stages/repro && node tools/concurrent2.mjs test/stages/repro` | 0 | 9/9 pass; repeat 5/5; concurrent 2/2 |
| `node tools/red-receipt.mjs out/s4c/red-group-c.log --expect-ids out/s4c/group-c.ids` (red log copied from `logs/s4t-browser-group-red.log`) | 0 | 9 assertion failures |
| `node tools/red-receipt.mjs --green out/s4c/green-group-c.log --same-ids out/s4c/red-group-c.receipt.json` | 0 | all 9 red ids pass |
| `node tools/repeat.mjs 5 test/stages/prove test/stages/predicate --test-concurrency=1` | 0 | 5/5 |
| `node tools/concurrent2.mjs test/stages/prove test/stages/predicate --test-concurrency=1` | 0 | 2/2 |
| Seeded control: scratch copy under `out/`, predicate check replaced by `verdict === "reproduced"`, `node --test --test-name-pattern TC-R06-5 test/stages/repro` | 1 | TC-R06-5 fails: the false first verdict ends the run, so the second held model request never arrives |
| `strace -f` on the group c tests, then `out/s4c/loopback-check.py` | 0 / 0 | 41 loopback connects, 9 UDP route probes with no send, 0 non-loopback traffic |
| Group c tests in a copy whose `src/` holds only `ember.mjs` and the three S4c modules | 0 | 9/9 pass |
| `out/s4c/page-injection-check.mjs` (scratch) | 0 | page text addressed to the agent is never in the prompt; status stays `not_reproduced` over 3 attempts |
| `node tools/check-public.mjs --tree .` | 0 | 393 files, 0 findings |
| `az-lint --changed main` | 0 | shellcheck, shfmt, biome, gitleaks pass; semgrep 0 findings |
| `az-simplicity --changed main --format json` | 0 | 0 findings in S4c files (35 in other groups' files) |

## Acceptance to evidence

| Item | Evidence |
| --- | --- |
| 1. CMD-BROWSER cases pass under their ids; green against red | Gate exit 0; green receipt for TC-R06-1 to 5 and TC-R07-1 to 4 against the red receipt of the same 9 ids |
| 2. Trust boundaries have passing negative tests | Model output: TC-R06-3 (undeclared actions dropped), TC-R06-4 and TC-R06-5 (false verdict does not count), TC-R07-2 (bad candidates rejected). App under test: TC-R06-2 (page links to another origin, a file URL and a download are blocked; decoy 0 hits); page-injection scratch check. Sandbox: TC-R07-3 (no credential, network, outside read, timer and memory controls), TC-R07-4 (refuses without isolation, no model request) |
| 3. Zero requests leave loopback | strace connect and send audit: 0 non-loopback traffic. Chromium's IPv6 route probe connects a UDP socket and sends nothing |
| 4. Other groups' modules not required | Group c tests pass with only `ember.mjs` and the S4c modules in `src/` |

## Failure states (processes, files, money)

| State | Handling |
| --- | --- |
| Generated test hangs | Parent kills the process group at `timeoutMs` (reason `timeout`); `isolate.sh` also kills after `timeoutMs + 5 s` if the parent dies |
| Generated test exhausts memory | Data-segment limit `memoryMiB + 64 MiB` plus heap limit; V8 aborts (reason `memory_limit`). The heap flag alone is soft: one large allocation exceeded it in a probe |
| Generated test writes a lot | Writes land in a 256 MiB tmpfs inside the namespace, never on the host disk; retained output is capped at 64 KiB per run |
| Generated test reads outside, opens a socket or spawns | Permission model denies outside reads, child processes, workers and addons; home, temp, `/run` and `/proc` of other processes are hidden; loopback is down |
| Parent crash mid-attempt | The child dies on the backstop; the `foley-proof-*` temp copy can remain in the temp directory (no host data in it) |
| Concurrent prove or repro runs | Unique `mkdtemp` copies, per-run namespaces and tmpfs; browser contexts per attempt; `tools/concurrent2.mjs` 2/2 for both |
| Model call refused or failed | Repro and prove stop at the first non-`ok` status (for example `budget_refused`); no attempt after the case budget (TC-R06-5) |
| Retry | Repro attempts are bounded at 3 and steps at 25 per attempt; prove rounds at 4. Each model call reserves through `callEmber` |
| Partial artifact write | `replay.json` and `proof.json` are written to a temporary name and renamed. `regression.test.mjs` is written only after the no-model rerun matches |
| Browser or app failure | The exception propagates to the caller; the browser and context are closed in `finally` |
| Flaky acceptance | A rerun that differs returns `not_verified` with reason `rerun_mismatch` and writes no test file |

## Design notes

- The candidate runs by executing the file with Node (node:test runs in
  process, TAP reporter); `node --test` would spawn a child, which the
  permission model denies.
- Reason classification: `wrong_predicate` when the test passes on the bug
  build, or fails on a named assertion other than the candidate's, or does
  not reference `predicate.expected`; `unconditional_failure` when the only
  failures carry Node's generated assertion text, or the fixed build is also
  red.
- The accepted `biome-ignore lint/complexity/noExcessiveLinesPerFunction` on
  `prove` satisfies `az-simplicity`; the repository's biome configuration
  does not enable that rule and reports it as an unused suppression
  (warning, exit 0).

## Tests believed wrong

None.

## Amendments

- Plan gap, recorded: no committed test covers a page that prints
  instructions to the agent; covered by the scratch check above and by
  design (page text is never sent as text, only the declared actions run,
  the predicate decides).

## Remaining risks

- Acceptance reads TAP text from the untrusted process. A candidate that
  prints a forged failure block and exits 1 only on the bug build could be
  accepted; it would still have to tell the builds apart.
- The memory limit counts private writable memory, not the exact heap.
  A limit below about 64 MiB makes Node hang at start instead of failing;
  the time limit then ends it as `timeout`.
- The `node-test` runner is the only supported runner. The real target's
  Vitest runner is not wired into `prove`.

## Blocker

None.

## Log digests (SHA-256)

| File | SHA-256 |
| --- | --- |
| `out/s4c/green-group-c.log` | `218a44b1615d4b3a34091d25b605f5ef43e38e3ecec0fb1f25c91d15e5e637fe` |
| `out/s4c/red-group-c.log` | `94ee8c2f426a6fb88bfa224f86c36cfbdc28ecab86124df62220e3e0a94db795` |
| `out/s4c/red-group-c.receipt.json` | `edfec3a684101f42d9c82cf395565ccb14ccdbfb4edc8887dd52a679aa5e7248` |
| `out/s4c/repeat.log` | `ff1865845a0dd74b0f430adcfa463d5da8af0666c3116f8428d618bc5ca208ef` |
| `out/s4c/concurrent.log` | `5e56676526d7530aa351b527ee7c0b16fa68d0bbade537d9075e040be02a3c5c` |
| `out/s4c/repeat-pp.log` | `c912b72e69d80b55a3950963e5a18112b05903e59a0d2a3f022b2b2785b68a5c` |
| `out/s4c/concurrent-pp.log` | `f80db85394e250f238a9eeb0aff5a6c1a07e944fe23d1cdcabf05f67874f069f` |
| `out/s4c/seeded-control.log` | `865ed818fe2580497d9d3ae517014703b0173f98bdbee32a64f98187f9ef3ad4` |
| `out/s4c/strace-full.txt` | `bb02b623d8164c4c8a3b01115fa774179960520e912820b4d4a0510bb503de26` |
| `out/s4c/group-c-only.log` | `7be6918a6c72420a5e2efe4976de5120e9210b0cab0ca07139be2a8f1177d880` |
| `out/s4c/simplicity.json` | `e42251608f3e2a0c4ccdbd342bbafcd5b12a1733fcc8ccc2feec4547653962d1` |
