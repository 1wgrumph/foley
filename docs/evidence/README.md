# Result evidence

Small copies of result files that the README cites. The full run folders are
under the Git-ignored `out/` and are not committed, because they hold
reporters' recordings. Each file was copied unchanged on 2026-11-25, except
`9852-repeats.txt`, which is an extract, and `w4-rescore.json`, which was
written by hand from the stored run folders.

| File | Copied from | Holds |
| --- | --- | --- |
| `9852-core-proof.json` | `out/demo/9852-repaired/core-proof.json` | Core-proof record of the 9852 demo run (run 24, after the review repair): stages, rerun without the model, artefact digests |
| `9852-repeats.txt` | `out/s6/rep-9852-run10.txt` to `rep-9852-run19.txt`; for runs 20 to 29, each run's `run.json` and `foley spend` | Exit, time, verdict and ledger total after each repeat run, with each run's cost |
| `w4-rescore.json` | Written by hand on 2026-11-25 | Stored results re-read under the two acceptance rules the review repair changed: two 8418 rows rescored, the nine earlier 9852 tests read (7 drive the interaction through input), and the ten runs after the repair |
| `pairs-runs-summary.json` | `out/core/summary.json` | Verdict of every pair run before repeatability, as recorded. Two 8418 rows recorded as `failure_observed` are `attempted_miss` under the repaired rule; see `w4-rescore.json` |
| `heldout-run1-report.json` | `out/eval/eval-report.json` | Held-out blind run, commit `00e38f7`. Its `top1` and `top5` of 0 mean that no entry has a file label, not a measured miss |
| `heldout-run2-report.json` | `out/eval/run2/eval-report.json` | Held-out diagnostic rerun, commit `17791cf`, not blind. Its costs add the blind run's spend for each issue; `top1` and `top5` as above |
| `census-summary.json` | `out/backlog/summary.json` | Census status counts, rerun and first run |
| `census-rows.json` | `out/backlog/rows.json` | One row per census issue: status, first-run status, set, cost and reason |
| `spend-summary.json` | `out/spend-summary.json`, written by `node bin/foley.mjs spend` | Ledger total and spend per stage |
