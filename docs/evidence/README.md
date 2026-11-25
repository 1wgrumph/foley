# Result evidence

Small copies of result files that the README cites. The full run folders are
under the Git-ignored `out/` and are not committed, because they hold
reporters' recordings and raw prompts. Each file was copied unchanged on
2026-11-25, except `9852-repeats.txt`, which is an extract.

| File | Copied from | Holds |
| --- | --- | --- |
| `9852-core-proof.json` | `out/demo/9852/core-proof.json` | Core-proof record of the 9852 demo run (run 18): stages, rerun without the model, artefact digests |
| `9852-repeats.txt` | `out/s6/rep-9852-run10.txt` to `rep-9852-run19.txt` | Exit, wall time, verdict and ledger total after each repeat run, with each run's cost as the ledger difference |
| `pairs-runs-summary.json` | `out/core/summary.json` | Verdict of every pair run before repeatability |
| `heldout-run1-report.json` | `out/eval/eval-report.json` | Held-out first run, commit `00e38f7` |
| `heldout-run2-report.json` | `out/eval/run2/eval-report.json` | Held-out second run, commit `17791cf`. Its costs add the first run's spend for each issue |
| `census-summary.json` | `out/backlog/summary.json` | Census status counts, rerun and first run |
| `census-rows.json` | `out/backlog/rows.json` | One row per census issue: status, first-run status, set, cost and reason |
| `spend-summary.json` | `out/spend-summary.json`, written by `node bin/foley.mjs spend` | Ledger total and spend per stage |
