# W3 run-integrity regression interface

Preserve the S4T, S4x and W2R names and CLI exit codes. These cases use independent
CLI processes, the existing owned archive app, and loopback scripted responses.

- `out/foley-run.lock`: persistent lock inode, OS exclusive lock held for the
  whole run/backlog pipeline. A concurrent CLI refuses with exit 2, `run_active`,
  before another request. After a killed owner, reacquisition is safe; ambiguous
  ownership must refuse. Never unlink a lock inode to acquire/release it.
- One per-issue durable stage journal (reuse `out/runs/<issue>/state.json` where
  feasible): stage start and commit records, attempt count, results and status.
  Both `run` and `backlog` use the same authority. A committed stage is never
  repeated across commands; an interrupted stage has at most one further attempt.
  A third invocation after two interrupted visits finishes as `attempted_miss`
  without transmitting again (run exit 1). `backlog --fixture` denotes synthetic
  inputs, with the same semantics as `run --fixture`.
- `run.json` and `backlog-report.json` `cost_micro_usd` include settled and still
  booked amounts for that issue. `spend-summary.json` retains `settled`, `booked`,
  `total`, `per_stage`; the latter includes booked liabilities. Reconciliation
  uses durable call association, survives interruption after Ember commits, and
  is idempotent on another invocation. Preserve original Ember call identifiers.
- `completion.json` is the per-issue final commit marker, published last, after
  final `run.json`, report, replay and manifest/trace publication and validation.
  A missing marker is incomplete even if `run.json.state` is `finished`.
  Resume repairs incomplete finalization without further model requests. A report
  error must not result in `proof_verified` or a completion marker.
- `checkCoreProof(runDir)` retains `{status}` and `ok` for a complete verified
  fixture, `digest_mismatch` for changed/missing referenced bytes; any other
  status is nonverified. Require complete stage/artifact inventory, matching
  run/manifest identity, observed predicate and verified test/rerun semantics;
  require the trace to cover exactly the inventory.
- While a second repro turn is held at the server, the first executed action
  and its screenshot must already be in `run.json.replay`, visible on `--live`.
  The snapshot retains S4x observation/reason fields.
- All `census.json` rows exist before the first request of an issue, and the
  current issue's terminal status is present before `replay.html` export, even
  on the earliest miss. Preserve S4x DOM identifiers and row order.
- Invalid recording type/size/content or non-file: exit 2 with `refused_input`
  before copy/full read or any model request; no invalid asset in the run folder.
  Cached media outside the working tree refuses with `outside_working_tree`.
  Preserve `media_missing` and `media_digest` for missing/mismatched cache data.
  Audio extraction failure on otherwise valid media records watch
  `refused_input`, terminal `attempted_miss` (run exit 1), and no model request.
- Dirty tracked target source refuses with `target_not_pinned` (exit 2).
  A changed recording digest, target revision, runner or fixture mode for an
  existing issue refuses with `resume_mismatch` (exit 2), before model calls or
  replacing existing run artifacts. Matching identity resumes unchanged.
