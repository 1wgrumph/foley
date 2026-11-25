### Added

- Ember client slice S2. `src/ember.mjs` is the only module that calls the
  network. Its budget governor keeps an integer micro-dollar ledger in
  `out/ledger.json` and enforces the $9.00 cap. Each request reserves its
  priced upper bound under an exclusive lock before it is sent and settles
  from the reply's usage. Unknown spend stays booked, and reservations left by
  a crashed process stay booked and are traced as recovery. `out/trace.jsonl`
  reconciles to the ledger. Every call returns one status from the closed
  result set. All 16 S2T contract tests pass (`logs/green-s2.receipt.json`).
