# S2 Ember client: return

Author: the S2 Implementer. Date: 2026-11-24. Branch `wave-2`.
Planned slice, not a defect fix.

## Outcome: PASS

The objective command exits 0. All 16 S2T tests pass, and no file under `test/`, `fixtures/` or
`tools/` was edited. Every request in every run went to the local fake server. The suite's fetch
guard records any other destination and recorded none, and no real network call was made.
Nothing was pushed.

## Changed paths

`src/ember.mjs` (new, 476 lines after biome formatting), `logs/green-s2.receipt.json`,
`changelog.d/wave-2.md`, `logs/S2-RETURN.md`. Scratch, Git-ignored: `logs/green-s2.log`,
`logs/repeat-*.log`, `out/seeded-lockskip/`, `out/seeded-*.log`, `out/az-*`.

## Commits (14842c7..wave-2)

- 8235d3d Add Ember client with locked micro-dollar budget ledger (S2)
- b54b8ec Record S2 green receipt against the S2T red ids
- 58d3fa1 Add wave-2 changelog entry for S2
- (this return file is committed after these)

## Commands and exit codes

| Command | Exit | Result |
| --- | --- | --- |
| `FOLEY_OFFLINE=1 node --test test/ember/ > logs/green-s2.log && node tools/red-receipt.mjs --green logs/green-s2.log --same-ids logs/red-s2.receipt.json` | 0 | 16/16 pass, 0 cancelled; "green receipt: all 16 red ids pass"; log sha256 `7c7d742c…7958` |
| Seeded lock skip: patched copy in `out/seeded-lockskip/` (`withLock` runs the transaction with no lock), TC-R01-3 and TC-R01-4 | 1 | 2/2 fail by assertion: both calls return `ok` where one must be `budget_refused`, so the cap is overrun. Failed 4 of 4 runs. |
| TC-R01-4 and TC-R01-5, five runs in a row | 0 ×5 | 2/2 pass each run, about 0.3 s, no hang |
| TC-R01-4 and TC-R01-5, two copies at the same time | 0, 0 | 2/2 pass in each copy |
| `node tools/check-public.mjs --tree .` | 0 | 312 files, 0 findings; runtime network hosts: `api.meta.ai` only |
| `az-lint --changed wave-1` | 0 | biome, gitleaks PASS; semgrep advisory 0 findings |
| `az-simplicity --changed wave-1 --format json` (advisory) | 0 | 7 findings. Two are in `src/ember.mjs`: `priceBound` cognitive complexity 19 and `callEmber` 18 (limit 17); the worst is 19. The other 5 are in the S2T test files. |

## Design as built (code-simplicity return)

Covered contract items:
- reserve under the lock before sending;
- settle from usage;
- unknown usage stays booked;
- crash leaves the reservation booked, traced as recovery on the next locked call;
- untraced settlement is traced as recovery;
- refusal when `total + bound > min(ledger.cap, 9,000,000)`;
- case budget;
- live calls refused while the baseline is unset;
- over-cap baseline refused;
- missing or corrupt ledger refused;
- a lock with a dead owner is reported, not deleted;
- fixed URL and model, loopback override only in test mode;
- one Retry-After retry with its own reservation;
- closed result set;
- the key never reaches a result, trace, ledger or prompt file.

There was nothing to reuse: no existing module in the repository does this. Node standard library
only, no new dependency.

New abstractions, each with one reason:
- `withLock` (shared by reserve, settle and baseline),
- `reserve` and `settle` (the two ledger transactions in DES-FOL-R01),
- `recover` (crash rule, run inside each reservation),
- `priceBound` and `usageCost` (bound and actual price),
- `storePrompt` (DES-FOL-R02 prompt by digest),
- `send` (one HTTP exchange, so the retry reuses it),
- `config` (per-call environment rules from DES-FOL-R03).

Kept under "Never cut":
- input validation at the trust boundary (config, message shape, integer budgets);
- the lock, and fail-closed handling of unreadable ledgers and locks;
- no echo of reply bodies, which can carry the key.

Choices the tests leave open:
- Every non-`ok` outcome without usage keeps its reservation booked: 429, 400, 500, timeout,
  unreadable reply. A reply with usage but bad content settles its actual cost and returns
  `malformed_output`.
- A Retry-After above 60 s, or one given as an HTTP date, is not retried.
- The lock is a hard link of a complete `{pid}` file, so a reader never sees a half-written owner.
- Lock wait is at most 10 s, then `ledger_unreadable`. The ledger is written by temp file and rename.
- The ledger holds per-case settled spend in `cases` (allowed by S2T) and a `pid` on each open item,
  which `recover` uses to tell live reservations from crashed ones.

## How the next slice records the baseline and makes one live call

Run from the Foley root (paths are relative to the working directory). The owner supplies the
baseline in micro-dollars; for example, $0.42 is `420000`.

```sh
node --input-type=module -e 'import { recordBaseline } from "./src/ember.mjs"; console.log(await recordBaseline(Number(process.argv[1])))' 420000
```

The command creates `out/ledger.json` if it is absent and appends one `baseline` event. It throws
instead of overwriting an existing baseline or an unreadable ledger.

One live call. This is an owner-authorized paid action: it needs `MODEL_API_KEY` in the
environment, and `FOLEY_OFFLINE` and `FOLEY_EMBER_BASE_URL` must be unset.

```sh
node --input-type=module -e 'import { callEmber } from "./src/ember.mjs"; console.log(await callEmber({ messages: [{ role: "user", content: "Reply with the JSON object {\"answer\":\"ok\"} and nothing else." }], max_output_tokens: 64, caseId: "probe-1" }))'
```

Expected result: `{ status: "ok", output: { answer: "ok" } }`. Then `out/trace.jsonl` holds one
`request` event with token counts and `cost_micro_usd`. This slice did not run it.

## Tests I believe are wrong

None. All 16 pass together without weakening.

## Remaining risks

1. **The output limit's field name is unverified.** The request sends `max_completion_tokens`. If
   the Meta endpoint ignores that name, output is unbounded and a reply can cost more than its
   reservation. The W2 protocol probe must confirm the name and that the limit is enforced, before
   any larger call. The cap check uses the bound; settlement records the true cost.
2. **The text bound may undercount.** It counts one token per UTF-8 byte, priced as uncached input.
   This is conservative for normal text but omits chat-template overhead tokens, so a very short
   prompt can settle a few micro-dollars above its bound. The 1,600-token frame bound is also
   unmeasured. Both are for the probe to measure (S2T noted the same).
3. **Spend above the bound is settled anyway.** If real usage exceeds the bound, `settled` can pass
   the cap by that excess on the last call. No later call is admitted.
4. **A truncated trace line disables recovery tracing.** The ledger stays correct and keeps money
   safe, but trace reconciliation would need a manual repair.
5. **A reused pid hides a crash from the trace.** If a crashed process's pid is reused, its
   reservation stays booked (safe) but is not traced as recovery until that pid exits.
6. **Repeats ran on Node 22 only.** Each run took about 0.3 s on this host.

7. **History status (corrected 2026-11-24).** The orchestrator rewrote the two earlier return
   commits before any push. The W2 review checked every reachable commit in `main..wave-2` and
   found no routing term in any diff or message, and this repair rechecked the same range. No
   history change is needed.

## Blocker

None.
