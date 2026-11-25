# Pointer and pair-run interface

Preserve the S4T, S4x, W2R and W3R contracts, including selector actions,
the offline model transport, the independent page predicate and isolated
test execution.

## Pointer actions

The fixed viewport is 1280 by 720 CSS pixels, with device scale factor 1.
The reproduction prompt states both dimensions. Every observe screenshot
sent to the model has those PNG dimensions.

| Action | Required fields |
| --- | --- |
| `pointer_click` | `x`, `y` |
| `pointer_double_click` | `x`, `y` |
| `pointer_move` | `x`, `y` |
| `pointer_drag` | `x`, `y`, `to_x`, `to_y` |

All coordinates are integers: 0 <= x < 1280 and 0 <= y < 720.
The destination follows the same limits. Coordinates name viewport pixels,
not page-relative points or selectors. The whole model turn is validated
before any action runs. Invalid pointer fields stop it with a
`stopped` replay event whose reason is `malformed_output`.
Recorded steps use the same action fields, plus their existing order,
timestamp and target. Validate them in the steps/run schema and replay
them in the scripted page control, with the same coordinate bounds.
No selector is required for pointer actions. Existing selector actions
retain their meaning. Origin and download restrictions still apply.

## Pair runs

`foley run --pair <issue> --recording FILE --case-budget MICRO_USD`
selects a pair instead of a positional issue. Existing `--probe` and
`--fixture` remain available; the latter is for synthetic controls only.
The recording is local and its SHA-256 must agree with the selected
pair. Resolve the pair manifest at `fixtures/pairs/pairs.json` in the
working directory, schema `foley.pairs/1`. Read:

- `pairs[].issue`, `url`, `bug_commit`, `fix_commit`,
  `recording.sha256`, and optional `runner` (default `vitest` for the
  existing Excalidraw entries). Honor existing optional `memory_mib`.
- `out/pairs/<issue>/receipt.json`: `issue`, `scan_verdict`,
  and the two `builds[]` entries with `side` (bug or fixed), `commit`,
  and `page` (working-directory-relative build path).
- Checkouts are `out/pairs/<issue>/bug` and
  `out/pairs/<issue>/fixed`. Each receipt commit and checkout HEAD must
  match the corresponding manifest commit; preserve the tracked-clean
  check. Each receipt page must be inside its corresponding checkout
  and have an index.html. Require a passing scan verdict.

Run the ordinary watch, locate, repro, prove and report pipeline. Serve
the bug page on ephemeral loopback for reproduction and pass both receipt
page directories to proof's independent control. Real Vitest pairs retain
the 1,024 MiB memory default already exercised by the pair proof helper,
unless `memory_mib` overrides it.
The 256 MiB generic proof default is not sufficient for this target:
the repeat gate observed a Vitest out-of-memory failure on #9852.
Do not take target, revision, runner or origin from a conflicting CLI
override. No fetch or build occurs in pair mode.

Refusals before model traffic, with exit 2:

| Code | Condition |
| --- | --- |
| `pair_missing` | Issue not in the manifest |
| `pair_build_missing` | Receipt, checkout or built page absent |
| `pair_commit_mismatch` | Receipt or checkout commit disagrees with manifest |
| `pair_invalid` | Invalid pair or receipt, unsafe paths, or scan not passed |
| `media_digest` | Recording digest differs |
| `resume_mismatch` | Existing journal has different input identity |

Use the existing `out/runs/<issue>/` run folder. In pair mode add
`pair: {issue, bug_commit, fix_commit}` to the journal identity, run
document and core-proof manifest; `target_revision` remains the bug
commit. The proof check verifies the matching run/manifest pair binding.
A non-pair run identity has no pair field. A same-issue pair and census
run must refuse to resume one another rather than reuse artifacts or
model calls, even when all their ordinary input identity fields agree.
