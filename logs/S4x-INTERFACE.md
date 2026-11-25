# S4x replay evidence interfaces

Extends S4T groups a, c, u and i and the W2R transport contract. No existing
required field changes. Older run documents and older model replies remain valid.

## Reproduction, run and backlog implementer

- Model reply: `{actions, done, verdict, observation?}`. `observation` is an
  optional string of at most 1,024 UTF-16 code units. Each action may carry
  its own `reason`, an optional string of at most 512 UTF-16 code units.
  Both bounds are inclusive. The prompt names these fields and bounds.
- Validate the entire turn before executing its actions. Refuse a non-string
  (including null), over-limit or credential-shaped explanation as
  `malformed_output`. Follow the existing stopped-event convention: record
  `{type: "stopped", reason: "malformed_output"}`, never the rejected text.
  A first-turn refusal leaves `status: "not_reproduced"` and `observed: false`.
  Never persist credential-shaped explanation text in any artifact or prompt.
- Each executed `type: "action"` event in `replay.json` contains the turn's
  `observation` and that action's `reason` when supplied. Omit missing fields;
  do not carry either across turns. Preserve the exact same fields on the
  matching `run.json` `replay.events` action, including after prove/report.
  Keep blocked-event reasons and existing model-call evidence independent.
- Census: `runRoot/<issue>/census.json` for each started issue. This is a JSON
  array of exactly `{issue, status}` rows (positive numeric issue, closed
  `STATUSES` set in `src/run-schema.mjs`), in census input order, one row per
  candidate, including unattempted/excluded issues. No remote URLs or costs.
  Publish before report so its renderer can read the current outcome, and
  refresh all started run folders atomically as each issue settles, even a
  miss before report. Earlier records reflect completed issues before starting
  another. Resume uses persisted state, never appends duplicate rows. Publish
  by file replacement, not truncation; an open prior file retains its bytes.

## Replay UI implementer

- Read action explanations from `run.json` `replay.events` using the existing
  step/action matching. In the existing `steps` region, give each timeline
  row `data-testid="replay-step"`. In it, the visible value elements have
  `data-testid="step-observation"` and `data-testid="step-reason"`; each is
  the exact recorded plain text or `Not recorded` when absent. Labels can be
  separate. Render the string as text, including markup-like strings.
- Read the in-folder `census.json` array as above. The visible census region
  has `data-testid="census-index"`; each row in input order has
  `data-testid="census-row"` and displays `#<issue>` and the status (spaces
  may replace underscores). A static row links to `replay.html` for the
  current issue, or to `../<issue>/replay.html` for a sibling issue whose
  replay file exists at export. A row with no replay file has no link. Derive
  link targets from verified numeric issue IDs, not model-provided paths.
  Check existence only; never read or embed a sibling run's artifacts or
  expand the live server's run-folder boundary. A static export is a snapshot
  of the census at its render time; re-export to view later census updates.
- On initial file open, no secondary file or network requests; both new
  regions are visible and axe has zero serious/critical findings at 1280×800
  and 390×844. Preserve existing seven-region and live/disconnect contracts.
