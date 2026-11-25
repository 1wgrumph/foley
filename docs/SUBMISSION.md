# Foley submission checklist

This document maps the judging rubric and the event rules to evidence in this
repository. Lines that start with `RESULT PENDING:` are filled from committed
evidence after the live runs; until then no result is claimed.

## Rubric to evidence

| Criterion (weight) | Evidence in the repository |
| --- | --- |
| Impact (30) | [README](../README.md) "Why it matters". `fixtures/census/census.json`: a dated census of 50 Excalidraw bug reports with video. `src/score.mjs`: success per attempt and per eligible issue, location accuracy, cost per bug. RESULT PENDING: census counts by status and cost per verified proof from `out/backlog-report.json` and `out/eval-report.json`, published under `trace/` |
| Meta AI tooling (25) | Muse Ember (`muse-ember-1.0`) through the Meta Model API is the only model, in `src/ember.mjs`. It reads recording frames (`src/watch.mjs`), chooses browser actions from screenshots (`src/repro.mjs`) and writes regression tests (`src/prove.mjs`). [docs/SAFETY.md](SAFETY.md) describes the spend governor. RESULT PENDING: published prompt and token trace with per-call tokens and cost |
| Technical depth (20) | [docs/ARCHITECTURE.md](ARCHITECTURE.md). Deterministic predicate checks (`src/predicate.mjs`), sandboxed test execution (`tools/isolate.sh`), a ledger with reserve-before-send under a lock (`src/ember.mjs`), resumable stage journal (`src/run.mjs`), a Rust adapter over BRAN (`foley-crates/bran-media-evidence`). Test suites under `test/`, with red and green receipts in `logs/*.receipt.json` |
| Demo (25) | `npm run demo:offline` runs the whole pipeline offline and writes a replay page. RESULT PENDING: demo video link, and the run folder of a real Excalidraw issue |

## Event rules to evidence

| Rule | How the repository meets it |
| --- | --- |
| AI functionality uses only `muse-ember-1.0` through the Meta Model API | `src/ember.mjs` holds the only network call. Host and model are constants; another model is refused before any connection. `tools/check-public.mjs` lists the network hosts named in runtime source and fails on any other model provider. Test `TC-R03-1` in `test/ember/` covers the refusal |
| Total model spend at most $10 | `src/ember.mjs` stops at $9.00 (`CAP = 9_000_000` micro-dollars). Each request reserves its priced upper bound before it is sent. Live calls need the recorded baseline of earlier spend. RESULT PENDING: final total from `foley spend` (`out/spend-summary.json`), published under `trace/` |
| Only work built during the event is demonstrated; prior work is identified | `vendor/bran/` is BRAN v0.4.0 (MIT OR Apache-2.0), imported unchanged at tag `baseline-bran-v0.4.0`. `git diff --exit-code baseline-bran-v0.4.0 -- vendor/bran` prints nothing. Everything after that tag is event work. See [README](../README.md) "Prior work and event work" and [NOTICE](../NOTICE) |
| Repository is public | Public-boundary check before each push: `npm run check-public` (gitleaks, `tools/check-public.mjs --tree .` and its self-test on `fixtures/public-negative/`). Reporters' recordings are referenced by URL and hash only |
| Prompt and token trace | Each request's tokens and cost are in `out/trace.jsonl` and in `run.json` per run. Raw prompts stay in `out/prompts/` and are not published. RESULT PENDING: the allow-listed, redacted trace and spend summary, committed under `trace/` |
| Setup steps | [README](../README.md) "Setup" and "Offline demo". Each command was run from a fresh clone; see `logs/S7d-RETURN.md` |

## Where the trace will be

The published trace goes in `trace/` at the repository root. It will hold the
allow-listed trace lines (time, stage, model, token counts, cost, outcome) and
the spend summary. `tools/check-public.mjs` rejects trace lines with any other
field. Raw prompts in `out/prompts/` are never published.

## Placeholders for the final slice

Fill each from committed evidence, with its date and source file:

1. RESULT PENDING: README "Results": core-proof issues (target 3), census counts, held-out scores, cost per attempted issue and per verified proof, total spend, demo video link.
2. RESULT PENDING: `trace/` with the redacted trace and spend summary, and links to it from this file and the README.
3. RESULT PENDING: the run folder of at least one real Excalidraw issue with its `core-proof.json`, linked from the Demo row.
4. RESULT PENDING: the Impact and Meta AI tooling rows above, with figures from `out/backlog-report.json`, `out/eval-report.json` and `out/spend-summary.json`.
