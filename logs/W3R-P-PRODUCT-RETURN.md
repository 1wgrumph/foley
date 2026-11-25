# W3R group P product return: proof quality

Outcome: **PASS**. Product head `a914e57` on `wave-3`; this return is
committed after it. Implementer: group P product. Logs are local under
`out/w3r-p/`, which Git ignores.

## Findings

| Finding | Root cause | Fix commits | Proving tests | Prevention |
| --- | --- | --- | --- | --- |
| W3-04 | `prove` accepted only node-test, and the sandbox copied the target into a 256 MiB tmpfs, which cannot hold Excalidraw's 931 MiB `node_modules`. | `d4fa74b`, `23399d1`, `94248ef` | TC-R07-1/native-vitest | `isolate.sh` layers the candidate over a read-only overlay of each build, so no copy is needed, and runs the target's Vitest or node-test. Unsupported runners are refused at preflight (exit 2) and in `prove` (`unsupported_runner`) before any model call. |
| W3-05 | Acceptance trusted the model's assertion label and a substring search of its code. | `d4fa74b`, `b7acd3d`, `7256026`, `572e386` | TC-R07-2/no-independent-control, /unrelated-build-difference, /predicate-provenance, /unavailable-fixed-oracle | Verified requires four things. First, an assertion fails on the bug build. Second, the runner reports `actual` equal to the predicate's observed value and `expected` equal to its expected value. Third, the fixed build passes. Fourth, both builds' pages, served on loopback and driven by the recorded steps with the scripted driver, show the observed value (bug) and positively show the expected value (fixed). Otherwise the result is `inconclusive` (no control) or a named rejection. Labels and code text are not read. |
| W3-06 | The schema allowed any predicate kind; only `visible_text` had a check. | `cb279c7`, `b2ee2c8` | TC-R06-4/discriminated-predicate, /page-oracles, /target-canvas-state, /console-recording; TC-R04-1/unsupported-watch-predicate; TC-R06-5/no-paid-reproduction | `validPredicate` discriminates four kinds, each with its own fields and distinct expected and observed values. `checkPredicate` reads page data only: visible text, element count, captured error-level console messages, and canvas state. Canvas state comes from Excalidraw's test hook, or from its committed local-storage scene in the production build. Repro stops a null predicate as `no_predicate` and an invalid one as `malformed_output` before any browser or paid call. Watch refuses malformed predicates. |
| W3-07 | Only the explanations were validated; malformed turns ran or consumed further requests. | `62ae468` | TC-R06-3/whole-turn | The whole turn is validated before its first action: the reply is an object with an `actions` array and a boolean `done`; a finished turn has a verdict; and each action has its own required fields. Unknown action names are still dropped. A bad turn stops as `malformed_output`. |
| W3-17 | The steps schema had no field for uncertainty or narration-only facts. | `cb279c7`, `c642952`, `e8ec3c0`, `205f7df`, `431e1b7` | TC-R04-5/evidence-bounds, /evidence-replay | `uncertainty` and `narration_evidence` hold at most 40 `{t_s, text}` entries (`t_s` 0 to 120, text 1 to 1,024 characters, no credential shape). They are kept through watch, `run.json`, `comment.md` and the replay (`data-testid` `uncertainty` and `narration-evidence`, shown as plain text). |
| W3-18 | Duplicate credential-shape lists in repro and the renderer. | `ce23610`, `62ae468`, `aa77177` | Existing paired refusal tests: TC-R06-3/observation, TC-R06-5/observation, TC-R14-1/observation. The interface notes that no behavioural red exists. | `src/text-safety.mjs` exports `hasCredentialShape`. The input (repro) and display (renderer) checks both remain, and the evidence schema uses it too. |

## Changed paths

Group P: `src/prove.mjs`, `src/predicate.mjs`, `src/repro.mjs`,
`src/watch.mjs`, `src/text-safety.mjs` (new), `tools/isolate.sh`, the
predicate and evidence parts of `src/run-schema.mjs`, and `ui/render.mjs`
(shared helper only).

Files outside group P, each limited to lines the fix could not avoid:

- `src/run.mjs`: preflight `unsupported_runner`, and copying the two
  evidence fields from watch into the run.
- `src/report.mjs`: evidence sections in the comment.
- `ui/player.js` and `ui/replay.html`: the evidence lists and the label for
  each predicate kind.
- `changelog.d/wave-3.md`: appended entry.

**Shared-worktree incidents:**

- Commit `94248ef` (my preflight line) also captured group R's then
  uncommitted `src/run.mjs` rewrite. Nothing was reverted, and HEAD's imports
  resolve. I notified the peer session.
- Commit `a946f26` (group R) had earlier captured one of my uncommitted import
  lines in `src/repro.mjs`. `ce23610` added the missing module.
- A peer reported that `ui/render.mjs` was left unformatted after my rename.
  `aa77177` formatted it.

## Commands

| Command | Exit | Result |
| --- | --- | --- |
| `FOLEY_OFFLINE=1 node --test --test-reporter=tap --test-concurrency=1 test/w3r/P.test.mjs` | 0 | 14/14 |
| `node tools/red-receipt.mjs --green out/w3r-p/green-P.log --same-ids logs/W3R-P-red.receipt.json` | 0 | all 14 red ids pass |
| `node tools/repeat.mjs 5 test/w3r/P.test.mjs --test-concurrency=1` / `node tools/concurrent2.mjs ...` | 0 / 0 | 5/5; 2/2 |
| `node tools/repeat.mjs 5 test/stages/prove` and `concurrent2` | 0 | 5/5; 2/2 |
| `FOLEY_OFFLINE=1 node --test test/ember/` | 0 | 50/50 |
| Group a (CMD-UNIT) | 0 | 11/11 |
| Group b (CMD-BRAN) | 0 | fast gate, crate tests, locate 2/2, vendor diff clean |
| Group c (CMD-BROWSER) | 0 | 9/9; repeat 5/5; concurrent 2/2 |
| Group u (CMD-UI) | 0 | 4/4; repeat 5/5; concurrent 2/2 |
| `FOLEY_OFFLINE=1 node --test test/e2e/` | 0 | 2/2 |
| `FOLEY_OFFLINE=1 node --test test/s4x/*.test.mjs` | 0 | 6/6 |
| `npm run demo:offline` | 0 | run and spend exit 0 |
| `node tools/check-public.mjs --tree .` | 0 | 0 findings |
| `az-lint --changed main` | 0 | all lanes pass; semgrep 0 findings |
| `az-simplicity --changed main --format json` | 0 | 1 advisory in group P files: `ui/player.js` `evidence()` at 57 lines, most of it pre-existing |
| Scratch: `out/w3r-p/w304-excalidraw.mjs` (known-good Vitest test through `prove` on the real pinned checkout, offline) | 0 | bug exit 0, `wrong_predicate`, not verified, about 1 s per round; checkout `git status` empty before and after |

## Failure states

| State | Handling |
| --- | --- |
| Generated test hangs | The parent kills the process group at `timeoutMs`; `timeout -s KILL` inside the sandbox is the backstop if the parent dies |
| Memory exhaustion | Data-segment limit plus heap limit; V8 aborts, reported as `memory_limit` |
| Writes by the test | Go to the overlay's tmpfs upper layer (256 MiB), never to the target or the host disk |
| File, network or process escape | After the pivot, only read-only `/usr`, the node binary, a private `/proc`, four device nodes, a two-line `/etc`, tmpfs `/tmp` and `/work` are reachable. Loopback is down, there are no capabilities, and no-new-privileges is set. node-test also keeps the Node permission model. |
| Parent crash | The `foley-proof-*` and `foley-control-*` temporary folders can remain; they hold no host data. Child processes die on the backstop. |
| Concurrent proofs | Unique temporary folders, per-run namespaces, port-0 control servers; two-copy runs pass |
| Spend and retry | Prove stops at the first non-ok model status. `inconclusive` stops the rounds. Rounds are capped at 4, and the control runs once per call. A null or invalid predicate stops before any call, in both repro and prove. |
| Partial write | `proof.json` and `replay.json` are written by rename. `regression.test.mjs` is written only after the rerun with no model call matches. |

## Tests believed wrong

None.

## Remaining risks

- The page control serves `index.html` from each build's root. The
  Excalidraw source checkout has none, so real-target proofs return
  `inconclusive` until built bug and fixed outputs are supplied.
- Runner-reported values come from untrusted output. They are a filter
  only; acceptance also needs the trusted page control and the fixed-build
  pass.
- Vitest needs child processes, workers and native addons, so its
  containment rests on the namespaces, the pivoted root and dropped
  capabilities rather than the Node permission model. No active escape
  probes were run (review gap G-W3-1 stands).
- The preflight refusal code is `unsupported_runner`; the interface also
  accepts `bad_argument`.

## Blocker

None.
