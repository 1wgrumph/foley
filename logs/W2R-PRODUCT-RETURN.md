# W2 repair (product): return

Implementer: Claude Code / Claude Opus 5.5. Date: 2026-11-24. Worktree `foley-wave-2`, branch `wave-2`.
This is a review repair of slice S2 on the frozen hackathon implementer route. It is not a new slice.

## Outcome: PASS

All 50 tests in `FOLEY_OFFLINE=1 node --test test/ember/` pass on the final head: the 16
original and the 34 regression tests. I edited no test, fixture or tool. Each product finding,
W2-01 to W2-08, is closed with a regression test that proves it. W2-11 is corrected. Nothing was
pushed, and no real network call was made.

## Head and changed paths

The head is the commit that adds this return (it follows 4f24ef3). My changed paths are
`src/ember.mjs` (682 lines), `logs/S2-RETURN.md`, `logs/green-s2.receipt.json`,
`changelog.d/wave-2.md` and this return. Scratch, Git-ignored: `logs/green-*.log`,
`out/seeded-lockskip-w2r/`, `out/w2r-*`, `out/az-*`.

My commits:
- 09db8cb Repair Ember client review findings W2-01 to W2-08
- d5841ae Correct the stale history note in the S2 return (W2-11)
- 4f24ef3 Split message part handling out of request preparation (no behaviour change)
- the receipt, changelog and return commit

The Test Implementer's commits are interleaved: ca99938, ca6a2e2, 12c41a2 and 959cb47.

## Commands and exit codes

| Command | Exit | Result |
| --- | --- | --- |
| `FOLEY_OFFLINE=1 node --test test/ember/` (full suite, `logs/green-all.log`) | 0 | 50 tests, 50 pass, 0 fail, 0 cancelled, 0 skipped |
| Packet gate as written: the full-suite log checked against `red-s2.receipt.json` | 1 | `receipt rejected: Unexpected test result count 50 !== 16`. The receipt tool requires an exact count, so the suite was split as in the next two rows (see the gate note). |
| The 16 original ids by exact name (`--test-name-pattern` from `test/ember/ids.txt`) to `logs/green-s2.log`, then `red-receipt.mjs --green … --same-ids logs/red-s2.receipt.json` | 0, 0 | 16/16; "green receipt: all 16 red ids pass" |
| `node --test test/ember/repair.js` to `logs/green-w2r.log`, then `red-receipt.mjs --green … --same-ids logs/W2R-red.receipt.json` | 0, 0 | 34/34; "green receipt: all 34 red ids pass" |
| Process and fault tests (TC-R01-4/5/6 and their subtests, TC-R02-2 and subtests, the TC-R12-1 storage and lock subtests), five runs in a row | 0 ×5 | 27/27 each, about 0.6 s, no hang |
| The same, two copies at once | 0, 0 | 27/27 each |
| Seeded control: copy in `out/seeded-lockskip-w2r/` with `transaction()` skipping the lock, TC-R01-3 and TC-R01-4 | 1 | 2/2 fail, 4 of 4 runs. A direct probe shows the cap is breached: both requests are sent when headroom allows one, and one settlement is lost to a concurrent overwrite. The ledger reads 8,990,000 against a real spend of 9,030,000. |
| `node tools/check-public.mjs --tree .` | 0 | 328 files, 0 findings; runtime hosts: `api.meta.ai` |
| `az-lint --changed main` | 0 | biome, gitleaks PASS; semgrep advisory 0 |
| `az-simplicity --changed main --format json` (advisory) | 0 | 12 findings in total, 3 in `src/ember.mjs`. The worst is AZS-TS-001 complexity 22 (limit 20) in `locked()`. The others are `prepare` at 21 and `call()` at 53 lines (limit 50). The remaining 9 are in test files. |

**Gate note.** `tools/red-receipt.mjs` (owned by the Test Implementer) checks `# tests N`
against the receipt's id count. A single full-suite log therefore cannot pass both receipts. I
ran the suite once per receipt instead, and kept the full run as separate evidence. A one-log
gate needs a subset option in the tool: the Test Implementer's change, not a product change.

## Findings

| Finding | Root cause (one line) | Fix commit | Proving tests | Prevention |
| --- | --- | --- | --- | --- |
| W2-01 | The bound priced content bytes only. Images were unbounded URLs, and settlement never compared actual cost with the bound. | 09db8cb | TC-R01-1/wire-framing, TC-R01-8/unbounded-image, TC-R01-2/bound-violation, TC-R01-1 (generated), TC-R03-1 (wire body equality) | The bound is computed from the exact serialized body. Images must be inline PNG of at most 1280 px. A cost above its bound is settled in full, traced `bound_violated: true`, and sets `ledger.stop`, which refuses all later admission. |
| W2-02 | The caller's mutable messages were priced, then re-read at send time after await points. | 09db8cb | TC-R01-2/first-snapshot, TC-R01-10/retry-snapshot | `prepare()` copies the allowed fields once into a wire string. Pricing, digest, send and retry all use that string. |
| W2-03 | Usage and output were trusted, test mode shared the live key, and `localhost` was accepted. | 09db8cb | TC-R12-1/success-credential, usage-credential, prompt-credential, case-credential; TC-R03-1/literal-loopback, offline-key | Usage must be safe non-negative integers. A key in prompt or case id is refused, and a key in output gives `malformed_output`. Test mode reads only `FOLEY_TEST_API_KEY` and allows only 127.0.0.1 and [::1]. |
| W2-04 | The ledger was written before the trace, append errors were swallowed, and a partial line blocked recovery. | 09db8cb | TC-R01-6/baseline-append, request-append, truncated-tail; TC-R01-5/kill-in-lock | Ledger-changing events are journaled in the ledger (`journal.seq`, `journal.pending`) before they are appended. Each transaction cuts a partial tail and replays missing events by `event_id`. |
| W2-05 | Settlement ignored a lost lock. Pid liveness stood in for ownership, and the ENOENT retry skipped the wall-clock deadline. | 09db8cb | TC-R01-4/settlement-lock, TC-R01-5/kill-in-lock, TC-R01-4 | A failed settlement returns `ledger_unreadable` and keeps the reservation booked. A reservation is owned only by pid plus `/proc` start time, and in this process only while the call is in flight. Legacy records without a start time are recovered. Lock waits use a `performance.now()` deadline on every path. A stale lock still fails closed. |
| W2-06 | Refusals were appended outside the lock and lost when the directory was missing. | 09db8cb | TC-R02-2/concurrent-refusal, fresh-refusal; TC-R01-6/refusal-append | Every refusal goes through `transaction()` under the lock, after `mkdir`. If its append fails it is journaled and replayed, and the call returns `ledger_unreadable`. |
| W2-07 | Case counters and reservations were not validated, and case lookup used inherited properties. | 09db8cb | TC-R01-12/case-domain, reservation-domain; TC-R01-11/own-case-key | `validLedger()` checks open entries (unique id, integer bound, string case) and case counters. Cases are held in a null-prototype map. |
| W2-08 | Storage and lock errors escaped `callEmber`, and any JSON reply type counted as `ok`. | 09db8cb | TC-R12-1/reply-content-types, prompt-storage, lock-create, lock-acquire, reserve-storage, settle-storage, lock-release | `callEmber` catches everything and returns `ledger_unreadable` with no exception text. Reply content must be a string holding a non-null, non-array JSON object. |
| W2-11 | The note described history the orchestrator had already rewritten. | d5841ae | `check-public --tree .`; scan of `main..HEAD` diffs and messages found no routing term | The return now states the verified history status. |

All findings verified against the code before fixing; none was wrong.

## Tests I believe were wrong

- TC-R01-1 (generated) at ca6a2e2 computed `baseline = cap - settled - open - bound + gap`, so
  `gap = -1` left one micro-dollar of headroom yet expected a refusal, and its final total check
  contradicted that formula. The Test Implementer corrected the sign in 959cb47; the corrected
  test passes. No other test disagrees with FOL-R01 to R03 or R12.

## Code-simplicity return

There was nothing to reuse: the new parts replace S2 code in place, and nothing is added except
the abstractions below. Standard library only.

New abstractions, each with one reason:
- `prepare` and `copyPart`: one validated snapshot, as W2-02 requires.
- `boundedFrame`: the frame contract in W2-01.
- `transaction` and `locked`: the single serialized, journaled ledger step shared by reserve,
  settle, refusal and baseline.
- `readTrace`: tail repair, so it lives in one place.
- `owned`: the reservation identity rule.

Kept under "Never cut": trust-boundary validation, the lock, fail-closed stale-lock handling, and
the rule that unknown spend stays booked.

## Baseline and one live call (updated)

Run from the Foley root, with no other Foley process running:

```sh
node --input-type=module -e 'import { recordBaseline } from "./src/ember.mjs"; console.log(await recordBaseline(Number(process.argv[1])))' 420000
```

It creates `out/ledger.json` if absent and journals one `baseline` event. It throws instead of
overwriting a baseline. If it throws after committing, the baseline is kept and the next call
traces it.

One live call. This is an owner-authorized paid action. Set `MODEL_API_KEY`; leave
`FOLEY_OFFLINE` and `FOLEY_EMBER_BASE_URL` unset. `FOLEY_TEST_API_KEY` is ignored in live mode.

```sh
node --input-type=module -e 'import { callEmber } from "./src/ember.mjs"; console.log(await callEmber({ messages: [{ role: "user", content: "Reply with the JSON object {\"answer\":\"ok\"} and nothing else." }], max_output_tokens: 64, caseId: "probe-1" }))'
```

The booked bound for this call is under 50 micro-dollars, and the real cost is settled from
usage. If the cost exceeds the bound, the request event carries `bound_violated: true` and
`ledger.stop` is set. Later calls are then refused (`budget_refused`) until an operator
investigates and deletes `stop` from `out/ledger.json`, with no Foley process running.

A stale `out/ledger.json.lock`, whose owner pid is dead, makes every call return
`ledger_unreadable`. The operator confirms the owner is gone, moves the lock aside (quarantine),
and the next call replays any journaled events.

## Remaining risks

1. **The price bound is unproven against the provider.** It is conservative by construction, at
   one token per serialized byte and all input at the uncached price. The 1,600-token frame and
   the `max_completion_tokens` field are still unverified. S3 must prove them. A violation is now
   safe: the full cost is recorded and admission stops.
2. **Ownership needs Linux `/proc`.** Without it, `START` is null and other processes treat every
   reservation as unowned: it stays booked but is traced as recovery early. The host is Linux.
3. **Durability covers process death, not power loss.** There is no fsync, as in S2.
4. **Two refusal edge cases can lose trace evidence, never accounting.** A refusal or recovery
   line that is itself cut by a crash mid-append is dropped by tail repair; recovery is re-derived
   and a refusal is lost. A refusal made while the lock is stale is not traced.
5. **Advisory complexity is just over the limit** in `locked()` (22), `prepare` (21) and `call()`
   (53 lines). I judged these single serialized flows clearer kept whole.
6. Node 22 only.

## Blocker

None.
