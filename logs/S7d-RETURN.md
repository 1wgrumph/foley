# S7d return: README and submission documents

Outcome: **PASS**.

- Date: 2026-11-25. Observer for all results: the S7d Implementer.
- Base: `main` `72fe58b`. Documents commit: `0415abe`. This return and one
  wording fix to `docs/SUBMISSION.md` are committed on top of it.
- No live model call was made. No product, test or fixture file was changed.

## Changed paths

| Path | Change |
| --- | --- |
| `README.md` | New: what Foley is, pipeline diagram with a text version, Muse Ember use per stage and what the model does not decide, prior work against event work, requirements, setup, offline demo, live run, results placeholders, limits, tests, licence and credits |
| `docs/ARCHITECTURE.md` | New: modules, data flow, run folder files, shared `out/` files, trust boundaries, closed result sets, each mapped to a file |
| `docs/SAFETY.md` | New: spend governor, sandbox, browser origin lock, reporters' recordings, refusals |
| `docs/SUBMISSION.md` | New: rubric and event rules mapped to evidence, trace location, placeholders |
| `changelog.d/wave-4.md` | New, S7 entry |
| `logs/S7d-RETURN.md` | This file |

## Gates

| Command (worktree) | Exit | Result |
| --- | --- | --- |
| `node tools/check-public.mjs --tree .` | 0 | 436 files, 0 findings |
| `az-lint --changed main` | 0 | gitleaks pass; semgrep 6 files, 0 findings |
| Relative link check of the five changed Markdown files (script) | 0 | 16 links, 0 broken |

## Clean-clone command table

Every row ran in a fresh `git clone` of the worktree at `0415abe` in a
scratch directory, offline except for `npm ci` and the Chromium download. The
README's `git clone https://github.com/1wgrumph/foley.git` was not run; a
local clone of the same commit stood in for it.

| Command | Exit | Result |
| --- | --- | --- |
| `npm ci` | 0 | |
| `npx playwright install chromium` | 0 | |
| `npm run build:ui` | 0 | `ui/dist/replay.html` written |
| `npm run demo:offline` | 0 | `issue 1: proof_verified`; spend `{"baseline":0,"settled":33,"booked":0,"total":33,...}`; `replay.html: 0 requests besides the page file; 0 console errors`; about 6 s |
| `git diff --exit-code baseline-bran-v0.4.0 -- vendor/bran` | 0 | No output |
| `node bin/foley.mjs help` | 0 | |
| `node bin/foley.mjs --version` (clone at `72fe58b`) | 0 | `foley 0.0.0` |
| `node bin/foley.mjs spend --dry-run` (clone at `72fe58b`) | 0 | |
| `FOLEY_OFFLINE=1 node --test test/ember/` | 0 | 50/50 |
| `FOLEY_OFFLINE=1 node --test test/e2e/` | 0 | 2/2 |
| `node --test test/stages/watch test/stages/report test/stages/backlog test/stages/score test/stages/schema` | 0 | 11/11 |
| `node --test --test-concurrency=1 test/stages/repro test/stages/predicate test/stages/prove` | 0 | 9/9 |
| `node --test test/ui/` | 0 | 4/4 |
| `cargo test --offline --manifest-path foley-crates/bran-media-evidence/Cargo.toml` | 0 | 2 passed |
| `node tools/check-public.mjs --tree .` | 0 | 436 files, 0 findings |
| `npm run check-public` (clone at `72fe58b`) | 0 | gitleaks clean; 0 findings; self-test 9/9 classes |
| `npm run preflight` (clone at `72fe58b`) | 1 | Expected in a clean clone: `target-runner` missing until `tools/target-pin.sh` builds Excalidraw. Not shown in the README |
| `tools/target-pin.sh --record fixtures/target.json` | not run | Needs network (clones and builds Excalidraw); no key |
| `node bin/foley.mjs baseline <micro-usd>` | not run | Owner-only; needs a live key for any effect |
| `node bin/foley.mjs run ... --live`, `node bin/foley.mjs spend` after a live run | not run | Needs a live key |

The scratch clones were removed after the runs.

## Placeholders left for the final slice

- `README.md` "Results": six `RESULT PENDING` lines (core-proof issues, census
  counts, held-out scores, cost per attempt and per proof, total spend and
  trace link, demo video link).
- `docs/SUBMISSION.md`: `RESULT PENDING` in the Impact, Meta AI tooling, Demo,
  spend and trace rows, and four numbered placeholders.
- `trace/` does not exist yet. Both documents name it as the location of the
  published trace and spend summary, as the design specifies.

## Product observations

- `npm run preflight` requires `az-lint`, a tool that is not public. A
  developer who clones the public repository and runs preflight will see
  `az-lint (not on PATH)` even with every runtime tool installed.
  Reproduction: run `tools/preflight-tools.sh` with `az-lint` removed from
  `PATH`. Origin: `tools/preflight-tools.sh` lines 57 to 61. Product or test:
  developer tooling. The README avoids the issue by not listing preflight as
  a setup step; the owning slice should decide whether `az-lint` stays
  required. Not changed here, because this slice may not edit tools.
- The `RESULT PENDING` marker and the README limits record the known gap: a
  real open issue has no fixed build, so `src/prove.mjs` returns
  `inconclusive` and the best real-issue status is `failure_observed`.

## Docs checklist

Evidence carries an observer and date (this file). Actors are named for owner
steps (baseline, key). Time-bound facts carry dates: the target pin
(`fixtures/target.json`, 2026-11-24). No secrets, tokens or home paths;
`check-public` passes. Plain technical English, edited with the unslop rules.
Commands were run as listed above. All relative links resolve. Terms are
consistent: Muse Ember, run folder, predicate, core proof, spend governor.

Blocker: none.
