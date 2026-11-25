# S3 return: live protocol probe

Author: the S3 Implementer. Date: 2026-11-25. Branch `wave-4`, head 3f301d5. Not pushed.

## Outcome: PASS

The first paid calls ran one at a time through `src/ember.mjs` only. Every
call's ledger tokens and cost equal the API's own usage. Video is accepted and
now enabled in the client behind `fixtures/ember/bounds.json`, with a test.
Audio is accepted by the API but not demonstrated as understood, so it stays
refused. Spend for this item: $0.013761 (13,761 micro-USD).

## Ledger setup

`out/ledger.json` (offline residue: settled 440 and one stale open entry) and
its trace `out/trace.jsonl` were moved to `out/ledger.offline.json` and
`out/trace.offline.jsonl`. `node bin/foley.mjs baseline 0` then started the live
ledger (exit 0). The trace moved with its ledger because the ledger replays
journal events against the trace's highest event id.

## Measured facts

| Fact | Measured |
| --- | --- |
| Endpoint | `POST https://api.meta.ai/v1/chat/completions`, model `muse-ember-1.0` |
| Output limit field | `max_completion_tokens` (counts reasoning) |
| Usage fields | `prompt_tokens`, `completion_tokens`, `prompt_tokens_details.cached_tokens`, `completion_tokens_details.reasoning_tokens` |
| Reasoning | Default effort is `max`; every call's output was mostly reasoning (for example 3,998 of 4,000) |
| Frames | 17 PNG frames at 1 per second, 1280 by 720: 20,520 prompt tokens, about 1,200 per frame; cost $0.00219 |
| Video | 16.56 s MP4 as a `video_url` data URL: 4,206 prompt tokens, about 251 per second; cost $0.000809 |
| Audio | `input_audio` WAV, 12 s: HTTP 200, 196 prompt tokens, but the model reported silence for a 440 Hz tone |
| Caching | An identical repeat of the frames request reported `cached_tokens` 0 |
| Prices | Ledger cost equals usage times $0.10/M input and $0.50/M output on all 11 calls; the cached price is unmeasured |
| Watch, video (TC-R04-3) | Valid steps after the fixes; 6 of 8 required actions (missed Ctrl+D and Ctrl+Z) |
| Watch, frames (TC-R04-4) | All 8 required actions in ground-truth order |
| Wall time | 1.3 s for the text call, 2.5 to 2.9 s for media calls, 4 to 5 s for Watch |

One anomaly: call 9 repeated call 8's exact request (same request digest) and
the API reported 23 prompt tokens with `cached_tokens` 0, against 4,619 for
call 8. The ledger records the API's figure ($0.000463 for that call). Whether
Meta bills that call by its usage object is not visible to Foley; the owner's
console shows it.

## Calls

| Event | Case | Outcome | Input | Output (reasoning) | Cost (micro-USD) |
| --- | --- | --- | --- | --- | --- |
| 2 | probe-text | ok | 27 | 23 (9) | 15 |
| 3 | probe-frames | ok | 20,520 | 275 (216) | 2,190 |
| 4 | probe-frames-again | ok | 20,520 | 300 (253) | 2,202 |
| 5 | probe-video | ok | 4,206 | 775 (724) | 809 |
| 6 | probe-audio | ok | 196 | 739 (709) | 390 |
| 7 | probe-watch-video | malformed_output | 4,619 | 4,000 (3,998) | 2,462 |
| 8 | probe-watch-video | ok, invalid steps | 4,619 | 1,690 (1,501) | 1,307 |
| 9 | probe-watch-video | ok, invalid steps | 23 | 884 (662) | 463 |
| 10 | probe-watch-video | ok | 4,650 | 1,171 (910) | 1,051 |
| 11 | probe-watch-frames | ok | 20,957 | 1,552 (1,247) | 2,872 |

Records: `out/probe/{text,frames,frames-again,video,audio}.json` (API usage
beside the ledger event and the reconciliation) and `out/probe/watch-*`.

## Defects found live and fixed

| Defect | Class | Fix | Red, then green |
| --- | --- | --- | --- |
| No request set a reasoning effort, so at Ember's default (`max`) a Watch reply spent all 4,000 output tokens on reasoning and returned no content | Product | `callEmber` accepts a validated `reasoning_effort`; Watch and proof send `medium` with 16,000 output tokens, reproduction sends `low` with 8,192 | Live Watch: event 7 `malformed_output` with 3,998 reasoning tokens; event 8 returned content. Offline: the new TC-R01-8 case (an invalid effort is refused before send; a valid one is sent) fails on the HEAD client and passes now |
| The Watch prompt described `target` as visible text, so pointer steps came back without one and failed validation; it also said `value` is only for `type`, so key presses came back without their key | Product | The prompt asks for a target on every step and the key for `key_press` | Live Watch: events 8 and 9 invalid steps; event 10 valid |
| Watch sent audio as an `audio_url` part, which the client does not accept | Product (latent; audio is refused) | Watch sends `input_audio` with format `wav`, the shape the probe sent | Offline suites |

## Changed paths

- `src/ember.mjs`: `video_url` (MP4 data URL) and `input_audio` (WAV) parts,
  priced at whole seconds times the bounds file's per-second ceiling and refused
  without one; MP4 and WAV durations are read from the bytes. Validated
  `reasoning_effort`. Over-200K-token requests are priced at the higher tier.
  Results carry the API's usage and stop reason (`api`), and the head of
  non-JSON content, never when it contains the key.
- `src/watch.mjs`, `src/repro.mjs`, `src/prove.mjs`: reasoning effort and
  output limits; Watch prompt; Watch prefers frames when the bounds mark video
  `preferred: false`; audio part shape.
- `fixtures/ember/bounds.json` (new): measured bounds. Video: accepted,
  251 tokens per second measured, priced at a 2,000 ceiling, 120 s limit,
  not preferred. Audio: refused.
- `test/probe.live.mjs` (new): the paid probe, one step per run.
- `test/ember/index.js`: TC-R01-8 extended (bounded video booked at its
  ceiling and sent with its effort; invalid effort refused; audio refused).
- `test/stages/support.mjs`: the shared request-shape check allows an optional
  `reasoning_effort` of `low` or `medium`.
- `test/w3r/R-artifacts.test.mjs`: TC-R04-2/audio-extraction-refusal drives
  Watch directly with its audio probe. Once measured bounds exist the CLI
  ignores `--probe` by design, so the CLI could no longer reach audio
  extraction; the assertion (refused before any model call) is unchanged in
  substance.
- `changelog.d/wave-4.md`, `logs/S3-RETURN.md`.

## Commands and exit codes

| Command | Exit | Result |
| --- | --- | --- |
| `node bin/foley.mjs baseline 0` | 0 | live ledger started |
| `node test/probe.live.mjs text`, `frames`, `frames-again`, `video`, `audio` (key loaded into the process only) | 0 each | see the table above |
| `node bin/foley.mjs spend` after the probe | 0 | total 13,761 micro-USD |
| `FOLEY_OFFLINE=1 node --test test/ember/` | 0 | 50 pass |
| `FOLEY_OFFLINE=1 node --test --test-concurrency=1 test/stages/` | 0 | 22 pass |
| `node --test test/ui/` | 0 | 4 pass |
| `FOLEY_OFFLINE=1 node --test test/e2e/` | 0 | 2 pass |
| `FOLEY_OFFLINE=1 node --test test/s4x/*.test.mjs` | 0 | 6 pass |
| `FOLEY_EXCALIDRAW_TARGET=<target> FOLEY_OFFLINE=1 node --test --test-concurrency=1 test/w3r/*.test.mjs` | 1, then 0 | 39 of 40, then the converted audio case passes alone |
| `FOLEY_OFFLINE=1 node --test test/s5w/*.test.mjs` | 0 | 12 pass, 1 skipped |
| `npm run demo:offline` | 0 | |

## Misses and remaining risks

1. Audio understanding is unmeasured: there is no owned speech sample and no
   local voice model. The pair recordings' audio tracks are digital silence
   (-91 dB), so the core proof does not need audio.
2. Video watches less well than frames on the owned clip (6 of 8 against 8 of
   8); Watch uses frames. Video stays enabled in the client.
3. The prices are the published ones; Foley cannot see Meta's billing. The
   cached price and the call-9 usage anomaly need the owner's console.

## Blocker

None.
