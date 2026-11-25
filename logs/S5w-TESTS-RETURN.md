# S5w test return

**Outcome: PASS.** All 13 new cases fail by assertion on the pinned
unfixed product, including the opt-in real pair. The established tests
continue to pass. The corrected integrated candidate passes the same
new cases and the repeat and concurrent gates.

Product basis for red: `bfcb22e`. The interface was committed first
(`ce2fa45`). Test implementation: `6701e23`; fixture and test-driver
repair: `5e78a47`. Resource clarification: `dde75ec`, `063fea8`.
Integrated verification head (before this return): `fc537fe`.

## Scope and independent oracles

- The owned canvas app uses real browser pointer events and a small
  scene model. An independent Playwright session confirms the rectangle
  coordinates and selection state before Foley's driver is tested.
  The generated regression candidate exercises the same scene logic.
  It must fail on the bug build, pass on the fixed build, and pass
  the product's independent scripted-page control and no-model rerun.
- The synthetic pair uses the existing owned archive app. The source
  checkouts are independently pinned Git repositories; built pages
  are in nested ignored build directories, not at the checkout root.
  The recording is captured from the actual bug page, encoded locally,
  and matched to the manifest digest. The existing archive regression
  is the scripted proof reply. Each refusal has a fresh fixture.
- The real pair uses the existing #9852 manifest, local reporter media
  (verified against its digest), bug/fixed checkouts and build receipt.
  Its prepared copies have separate worktree indexes; the original
  builds are preserved. The replay uses the pointer points from its
  independent scenario and the existing native regression candidate.
  All model responses are scripted through the loopback server.
  No third-party media is committed.
- The repeat/concurrent driver passes the explicit local
  `FOLEY_PAIRS_DIR` opt-in through its synthetic-only test environment.
  Without that opt-in, the real case is skipped.

## Changed paths

- `logs/S5w-INTERFACE.md`
- `test/s5w/canvas/index.html`, `test/s5w/canvas/logic.mjs`
- `test/s5w/pointer.test.mjs`
- `test/s5w/pair-support.mjs`, `test/s5w/pair.test.mjs`,
  `test/s5w/pair-real.test.mjs`
- `test/s5w/ids.txt`, `tools/test-process.mjs`
- `logs/S5w-red.receipt.json`, this return

No product source, UI, CLI, or isolation script was edited by this
test change. No dependency was added.

## ID table

| ID | Observable coverage | First red assertion |
| --- | --- | --- |
| `TC-R06-1/pointer-draw-select` | Draw and select using pointer drag, move, click, double click; selector still works | Observed failure is false |
| `TC-R06-1/pointer-viewport` | Actual request PNG 1280 by 720; prompt states dimensions | Dimensions absent from prompt |
| `TC-R06-3/pointer-whole-turn` | Eight invalid coordinate cases: bounds, fractions, missing fields, wrong type | Valid leading action runs; invalid pointer dropped rather than malformed turn |
| `TC-R06-3/pointer-recorded-schema` | Valid recorded actions including last in-bounds pixel; same invalid matrix | Valid coordinate steps rejected |
| `TC-R07-2/pointer-page-control` | Real independent page control proves bug and fix with recorded steps; native test red/green first | Not verified despite native red/green |
| `TC-R07-1/pair-build-missing` | Fixed built page absent | Wrong refusal: unrecognized pair flag |
| `TC-R07-1/pair-commit-mismatch` | Receipt mismatch, then manifest/receipt agree but checkout HEAD does not | Wrong refusal: unrecognized pair flag |
| `TC-R07-1/pair-unknown` | Unknown issue | Wrong refusal: unrecognized pair flag |
| `TC-R07-1/pair-receipt-boundary` | Fixed receipt names the real bug-side build page | Wrong refusal: unrecognized pair flag |
| `TC-R15-4/pair-core-proof` | Full CLI proof, both commits in journal/run/core; reject changed manifest binding | Exit 2 instead of 0 |
| `TC-R15-4/pair-resume-census` | Matching pair resume unchanged; census cannot reuse pair journal | Pair command exits 2 |
| `TC-R15-4/pair-resume-from-census` | Census records first; pair cannot reuse it | Wrong refusal: unrecognized pair flag |
| `TC-R15-4/pair-real-9852` | Actual Excalidraw pair, Vitest, native red/green, rerun, core proof | Exit 2 instead of 0 |

Every preflight pair refusal requires zero model requests and no new journal. Both
resume directions require the same ordinary revision, recording, runner
and fixture identity, so the pair binding is the distinguishing value.

## Gate commands and results

Raw logs: ignored `out/s5w/`. The red product was copied to
`out/s5w/pinned/` with product files extracted using
`git show bfcb22e:<path>`; their Git object hashes matched the pinned
source. Existing installed dependencies and built UI were available.
Set `FOLEY_OFFLINE=1` throughout, `FOLEY_PAIRS_DIR` to the prepared
local `out/pairs` for the opt-in gate, and
`FOLEY_EXCALIDRAW_TARGET` to the prepared pinned target for W3R.
The gate never fetches media or contacts a remote model endpoint.

| Command | Exit | Result |
| --- | ---: | --- |
| `node --test --test-reporter=tap out/s5w/pinned/test/s5w/*.test.mjs` | 1 | 13/13 assertion failures |
| `node tools/red-receipt.mjs out/s5w/S5w-red.log --expect-ids test/s5w/ids.txt` | 0 | Exact IDs and assertions |
| `node tools/repeat.mjs 5 out/s5w/pinned/test/s5w/*.test.mjs` | 1 | Expected red: 5/5 copies each fail 13/13 |
| `node tools/concurrent2.mjs out/s5w/pinned/test/s5w/*.test.mjs` | 1 | Expected red: 2/2 copies each fail 13/13 |
| `node --test --test-reporter=tap test/s5w/*.test.mjs` | 0 | 13/13 on corrected candidate |
| `node tools/red-receipt.mjs --green out/s5w/green-final.log --same-ids logs/S5w-red.receipt.json` | 0 | Exact red IDs now green |
| `node tools/repeat.mjs 5 test/s5w/*.test.mjs` | 0 | 5/5 copies pass 13/13 |
| `node tools/concurrent2.mjs test/s5w/*.test.mjs` | 0 | 2/2 copies pass 13/13 |
| `env -u FOLEY_PAIRS_DIR node --test --test-reporter=tap test/s5w/pair-real.test.mjs` | 0 | One skipped, zero failed |
| `node --test --test-reporter=tap test/ember/` | 0 | 50/50 |
| `node --test --test-reporter=tap --test-concurrency=1 test/stages/` | 0 | 22/22 |
| `node --test --test-reporter=tap test/ui/` | 0 | 4/4 |
| `node --test --test-reporter=tap test/e2e/` | 0 | 2/2 |
| `node --test --test-reporter=tap test/s4x/*.test.mjs` | 0 | 6/6 |
| `node --test --test-reporter=tap test/w3r/*.test.mjs` | 0 | 40/40 |
| `node tools/check-public.mjs --tree .` | 0 | Zero findings |
| `az-lint --changed main` | 0 | Format, lint, secret scan pass; zero advisory findings |

The six existing suites (124 cases) also pass on the pinned product.
Each extracted repeat/concurrent red TAP log passed the unchanged
receipt checker and had the same first assertion reason for every ID.
Each extracted green TAP log passed the same-ID green checker.
No skipped, cancelled, or todo cases in the opt-in red or green gates.

Red log SHA-256:
`f569e348b0caef0154432266c90547153d8e7e46b48a48c1b7d527b3371f6cf1`.

Committed red receipt SHA-256:
`1c1d27fb8add25c8f0fc8bc30026eb21d71c0186ded32f7d471e63e762516f30`.

Final green TAP SHA-256:
`800c0ba1b18d1b832a118a8137a556b579e5fa5561a397515432a41f0426edb7`.

## Corrections and limits

The first integration pass identified a fixture fidelity defect: its
untracked nested build was not ignored. The fixture now mirrors the real
build's ignored output path; the product also filters location evidence
to tracked revision files. The test-only changes preserve the independent
proof and red evidence.

The earlier integrated candidate passed 13/13 directly but only 3/5
repeat copies. All 12 non-opt-in cases passed all copies; the real pair
reported `rerun_mismatch` once and runner `memory_limit` once (Vitest
reported `FATAL ERROR: Zone Allocation failed - process out of memory`).
The generic 256 MiB proof default was insufficient. The real-pair helper
already exercised 1,024 MiB, retained as the pair-mode default in the
corrected product. The repeated gate was rerun on the new source, rather
than retrying the same failed candidate or relaxing assertions.
The corrected source object `8d438dcd971cb66a864cb5e7585c527bbf16e999`
was unchanged across the final gate and matches `fc537fe:src/run.mjs`.
The source, fixture and test file inventory also matched before and after.

Local repository-knowledge discovery was unavailable because the native
policy is absent; direct source and fixture inspection was used. The
actual location stage still ran through the ordinary adapter. No live
model, new real media, release, or additional pair was attempted.

**Blocker:** None for the test outcome.
