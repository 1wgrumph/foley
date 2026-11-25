### Added

- Ember client slice S2. `src/ember.mjs` is the only module that calls the
  network. Its budget governor keeps an integer micro-dollar ledger in
  `out/ledger.json` and enforces the $9.00 cap. Each request reserves its
  priced upper bound under an exclusive lock before it is sent and settles
  from the reply's usage. Unknown spend stays booked, and reservations left by
  a crashed process stay booked and are traced as recovery. `out/trace.jsonl`
  reconciles to the ledger. Every call returns one status from the closed
  result set. All 16 S2T contract tests pass (`logs/green-s2.receipt.json`).
- Wave 2 review repair (W2-01 to W2-08, W2-11). The governor prices the full
  serialized wire body, sends the output ceiling, settles costs above the bound
  in full and stops later admission until an operator clears it. It freezes
  one request snapshot for pricing, digest, send and retry. Ledger-changing
  events are journaled in the ledger and replayed after any failed or partial
  trace append, and refusals are traced inside the lock. Abandoned and legacy
  reservations are traced as recovery. Ledger fields are validated. Every
  storage and lock failure returns `ledger_unreadable`. Test mode uses its own
  synthetic key and only literal loopback addresses.
