# S2T return

## Outcome

PASS. The red-baseline gate completed on Node v22.23.4. All 16 assigned
product contract cases failed with the assertion
`src/ember.mjs is not implemented`. None failed because of import,
syntax, cancellation or timeout. The seeded import failure was rejected.

The fixture server uses an ephemeral IPv4 loopback port. Every test
scenario uses a unique temporary directory and synthetic credentials.
The process tests coordinate real child processes through IPC and share
only the scenario's ledger. The test fetch guard blocks unexpected
destinations; the positive live-mode control rewrites the fixed Meta URL
to the local server. No external network call was made. No product source,
dependencies, plan or vendored files changed.

## Changes and commits

| Commit | Changed paths |
| --- | --- |
| `476b7f7` | `test/fake-server.mjs` |
| `ea02fb0` | `tools/red-receipt.mjs`, `fixtures/ember/import-failure.mjs`, `fixtures/ember/import-failure.ids.txt` |
| `0b64fdc` | `test/ember/index.js`, `test/ember/ids.txt`, `fixtures/ember/worker.mjs` |
| Record S2T red receipt and return | `logs/red-s2.receipt.json`, `logs/S2T-RETURN.md` |

The exact directory-entry command requires `test/ember/index.js` on this
Node installation. The first attempt with only a named test file failed
at directory resolution. The index entry corrected that script defect.

The raw TAP logs under `logs/` are Git-ignored. The JSON receipt and this
return are permitted by the ignore rules. The commits remain on
`wave-2`; no push was attempted.

## Commands and exits

| Command | Exit | Evidence |
| --- | ---: | --- |
| `node --test test/ember/ > logs/red-s2.log; test $? -ne 0 && node tools/red-receipt.mjs logs/red-s2.log --expect-ids test/ember/ids.txt` | 0 | Node runner 1; receipt 0, 16 assertion failures |
| `node --test fixtures/ember/import-failure.mjs > logs/import-failure.log` | 1 | Intentional import failure |
| `node tools/red-receipt.mjs logs/import-failure.log --expect-ids fixtures/ember/import-failure.ids.txt` | 1 | Expected rejection: not an assertion |
| `node test/fake-server.mjs` | 0 | Ten scripted requests, both endpoints, fault replies, abort and held response |
| `timeout 60s node --test --test-name-pattern='^TC-R01-4$' test/ember/ > logs/concurrency-<run>.log` | 1 each | Five consecutive runs, then two simultaneous copies. All seven asserted the missing product module, with zero cancellations or timeouts. Each assertion check returned 0. |
| Receipt tool control, synthetic assertion test | 1 / 0 | Test runner red exit 1, red receipt 0 |
| Receipt tool control, same ID with passing test | 0 / 0 | Test runner green exit 0, green validation 0 |
| Receipt tool control, red log submitted as green | 1 | Expected rejection |
| `node tools/check-public.mjs --tree .` | 0 | No findings |
| `az-lint --changed wave-1` | 0 | Biome and gitleaks pass; semgrep advisory has no findings |
| `az-simplicity --format json` (installed tool) | 2 | Default base `origin/main` is absent |
| `az-simplicity --changed wave-1 --format json` (same installed tool) | 0 | Five nonblocking findings on test-fixture function length and reply dispatch complexity |

Red log SHA-256: `4c8e2c7cf1840eefaa4b87aff0f87050c4d6e3b5b8cd0fdd743d475d48d56e44`.

Receipt JSON SHA-256: `736e3add259fbbf55dac934ab91795ee05013a5323371eac7dad80ae89431e25`.

## Test IDs and proof cases

Each test name is exactly its SEIT proof-case ID. All 16 are bound to
CMD-UNIT-S2. TC-RED-1 binds the entire suite and receipt checker to
CMD-RED-S2.

| Test ID | SEIT proof |
| --- | --- |
| TC-R01-1 | Global budget refusal, byte-identical ledger, equality control |
| TC-R01-2 | Equality and one micro-dollar over, including settled and booked amounts |
| TC-R01-3 | Same-process concurrent calls above and below combined headroom |
| TC-R01-4 | Two OS processes share the ledger; dead-owner lock is retained and reported |
| TC-R01-5 | Kill after send before settlement; restart preserves booked liability |
| TC-R01-6 | Make the trace path a directory after send; settlement persists, restart reconciles once |
| TC-R01-7 | Observe reservation at the server before reply; missing usage remains booked, known usage settles |
| TC-R01-8 | Unbounded video/audio, missing output limit, over-limit input refused; bounded frame accepted and stored only by digest |
| TC-R01-9 | Unset and over-cap baseline refuse live calls; unset baseline permits a local test call; zero baseline permits simulated live call |
| TC-R01-10 | 429 retry needs its own reservation, observes Retry-After and stops when headroom runs out |
| TC-R01-11 | Case-budget refusal, accumulated case spend and separate case allowance |
| TC-R01-12 | Missing or corrupt ledger refuses without sending; valid ledger succeeds |
| TC-R02-1 | Usage mapping, 152 micro-dollar charge, parsed output and prompt digest |
| TC-R02-2 | Baseline, request, refusal and crash/recovery events reconcile to ledger total |
| TC-R03-1 | Other model and host refused, local override restricted to test mode, fixed request model and bearer credential |
| TC-R12-1 | Typed API faults and success; one event per transmitted request; no credential in results, child output, ledger, trace or prompts |
| TC-RED-1 | All 16 named tests fail by assertion, import-failure seed rejected, log digest recorded |

## Interface required by these tests

The design names `callEmber`, the ledger fields and trace event types.
The tests select the following remaining names and representations.

Exports from `src/ember.mjs`:

- `async callEmber({ messages, max_output_tokens, caseId, caseBudget?, timeoutMs? })`.
  Messages use chat roles and string content or typed content parts.
  Text parts have `type: "text"` and `text`. Media parts use
  `type: "image_url"`, `"video_url"` or `"audio_url"`, with a matching
  field containing `{ url }`. The tests use inline synthetic data URLs.
  `caseId` is a string. `caseBudget` is an integer micro-dollar ceiling
  for that case, including previous spend and open liability. `timeoutMs`
  is a millisecond timeout. The selected fixture bound counts text UTF-8
  bytes; each image adds 1,600 input tokens. Refuse unbounded video/audio,
  absent output limit, and input bound above 200,000. The priced bound is
  computed within the client, not supplied as a caller dollar estimate.
- `callEmber` resolves to `{ status, output?, message? }`. The closed
  status set is `ok`, `budget_refused`, `ledger_unreadable`, `api_error`,
  `rate_limited`, `timeout`, `malformed_output`, `refused_input`.
  On success `output` is parsed JSON, such as `{ answer: "ok" }`.
  Any error text must omit the credential. Missing usage maps to
  `malformed_output` and preserves the reservation. An exhausted 429
  returns `rate_limited`, including when the retry reservation is refused.
  Configuration refusal maps to `refused_input`.
- `recordBaseline(microUsd)` accepts an integer micro-dollar baseline,
  updates the ledger and appends a baseline event. Tests await the result
  but do not prescribe its return value. The test baseline is synthetic.

Environment (read per call):

- `MODEL_API_KEY`: bearer credential; only a synthetic value in tests.
- `FOLEY_OFFLINE=1`: explicit test mode.
- `FOLEY_EMBER_BASE_URL`: loopback URL ending in `/v1`, accepted only
  in test mode. With no override, the fixed base is
  `https://api.meta.ai/v1`. The fake server supports
  `/v1/chat/completions` and `/v1/responses`.
- `FOLEY_EMBER_MODEL`: if configured, only `muse-ember-1.0` is valid.
  The request body must always contain that fixed model ID.

Files relative to the caller's working directory:

- `out/ledger.json`: `{cap, baseline, settled, open}`. Values are
  integer micro-dollars, cap 9,000,000. Baseline null means unset.
  Each open item has `{callId, upperBound, caseId}`.
  Additional persisted case accounting is allowed.
- `out/ledger.json.lock`: exclusive lock, owner record `{pid}`.
  Remove it when the operation finishes. A lock with a dead owner is
  reported as `ledger_unreadable`, not silently deleted.
- `out/trace.jsonl`: event `type` is `baseline`, `request`,
  `refusal` or `recovery`. Include `cap_ledger_micro_usd` as
  the running total. A baseline event has `baseline_micro_usd`.
  Request events include `model`, `request_digest`, `outcome`,
  `input_tokens` (uncached), `cached_input_tokens`, `output_tokens`,
  `reasoning_tokens` when usage is known. `cost_micro_usd` and
  `booked_micro_usd` are event deltas; absent deltas mean zero.
  Recovery records `callId` for crashed reservations and only adds
  untraced cost or liability. Refusal events contain `outcome` and no
  `request_digest`. A quiescent trace sum must equal the ledger exactly.
- `out/prompts/<request_digest>.json`: digest uses SHA-256; content
  preserves prompt text and represents media by SHA-256 of decoded bytes.
  Do not store raw media data or credentials in this file.

Prices in micro-dollars per token: 0.10 uncached input, 0.004 cached
input, 0.50 output. Output usage includes reasoning, so record reasoning
without charging twice. The sample case has 500 uncached, 500 cached,
200 output and 120 reasoning tokens. Its independently computed cost is
152 micro-dollars.

## Remaining risks and blocker

No blocker for S2T. Product implementation and green evidence belong to
S2. The red runs prove fixture setup, missing-module assertions and
repeatability of the red test entry, not the cap invariant under actual
concurrency. The child-process race, crash/recovery, missing-trace
reconciliation and skipped-lock negative control must run against the
implementation. The smoke run verifies the scripted local protocol,
not provider compatibility or real token accounting. Only Node 22 was
used for these runs. The selected text bound is unverified against live
provider framing/tokenization; the live protocol probe is still pending.

The design's CMD-UNIT-S2 expects `logs/green-s2.log`, but its test runner
command does not redirect output to create that file. The green checker
was verified with a synthetic control. To obtain actual green evidence
when product code exists, capture Node TAP explicitly:

```sh
FOLEY_OFFLINE=1 node --test test/ember/ > logs/green-s2.log &&
  node tools/red-receipt.mjs --green logs/green-s2.log --same-ids logs/red-s2.receipt.json
```

The simplicity findings are advisory: the scenario and worker setup
keep resource lifetime together, and the fake server dispatches the
scripted reply modes in one place. BRAN was unavailable because the
worktree has no native policy; ordinary local discovery was used.
