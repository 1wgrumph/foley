# S4x replay UI return

**PASS.** On `wave-3`, implementation commit `4550669e3b5c7bc2be2b2c6731c21bfe8ccb4d21` passes both assigned IDs and all six integrated S4x cases. This return is the subsequent documentation commit. Resolve its hash with `git log -1 --format=%H -- logs/S4x-UI-RETURN.md`. No blocker.

## Delivered

The selected browser frame shows the model's recorded observation, action and reason, with attributed tokens and cost. The timeline shows each step's explanation independently, including `Not recorded` for an absent field. The viewer uses the existing event-to-frame match and the source recording clock. The frame shows the captured action result. The observation is the model's account of its input. Neither establishes the proof verdict.

Live mode follows the newest captured frame even when later steps already appear in the plan. Previous and Next retain their original recording controls. A disconnected viewer keeps the last received data and can revisit earlier frames and decisions. Reduced-motion mode removes the decision transition.

The issue census preserves input order, including unattempted issues. It accepts the new array and the older candidates wrapper. Only a verified positive integer can contribute to a link. Export checks sibling file metadata, omits links through symlinks, and never reads sibling contents. Live snapshots skip sibling discovery. The in-page Issue index link reaches the census directly.

| Changed path | Purpose |
| --- | --- |
| `ui/player.js` | Text-only explanations, action selection, live following, census rows and links |
| `ui/render.mjs` | Reject credential-shaped action explanations before export or snapshot delivery. Project census rows and resolve eligible static links. |
| `ui/replay.html` | Named decision panel, census landmark, navigation and empty states |
| `ui/replay.css` | Desktop and phone layouts, text wrapping, theme colors, motion and focus |
| `changelog.d/wave-3.md` | Appended the replay UI entry |
| `logs/S4x-UI-RETURN.md` | This return |

## Verification

Run from the repository root with Node 22.23.4. All browser and pipeline runs used `FOLEY_OFFLINE=1`. Evidence is local under `out/ui-evidence/s4x/`. The table uses that directory as `E`.

| Command | Exit | Result |
| --- | ---: | --- |
| `node --test test/s4x/` | 1 | Runner invocation. This directory has no index module. Node ran zero contract IDs. |
| `node --test test/s4x/*.test.mjs` | 0 | 6/6, including `TC-R14-1/observation`, `TC-R14-1/census-index` and the two negative producer cases |
| `node tools/red-receipt.mjs --green "$E/s4x.tap" --same-ids logs/S4x-red.receipt.json` | 0 | All six original red IDs passed without skips or cancellations |
| `npm run build:ui && node --test test/ui/` | 0 | Built the self-contained page. 4/4 earlier UI cases passed. |
| `node tools/repeat.mjs 5 test/ui` and `node tools/concurrent2.mjs test/ui` | 0 each | 5/5 serial runs and 2/2 simultaneous copies, 4 cases per run |
| `node tools/repeat.mjs 5 test/s4x/ui.test.mjs` and `node tools/concurrent2.mjs test/s4x/ui.test.mjs` | 0 each | 5/5 and 2/2, both assigned IDs in every run |
| `node --test test/e2e/` | 0 | 2/2 through the offline pipeline and exported replay |
| `node tools/repeat.mjs 5 test/e2e` and `node tools/concurrent2.mjs test/e2e` | 0 each | 5/5 and 2/2, 2 cases per run |
| `node "$E/observe.mjs"` | 0 | 36 desktop and phone checks, keyboard traversal, axe, overflow, reduced motion, local file opening and live updates |
| `node "$E/export-checks.mjs"` | 0 | Missing, invalid and symlinked sibling targets, metadata-only export, text validation and preservation of the prior page |
| `biome check ui/player.js ui/render.mjs ui/replay.css` | 0 | All three files passed |
| `node tools/check-public.mjs --tree .` | 0 | Zero findings |
| `az-lint --changed main` | 0 | Applicable checks passed, including the secret scan. Semgrep had zero findings. |
| `az-simplicity --changed main --format json` | 0 | 42 branch advisories. One involved this slice. The snapshot function measured 53 lines against the 50-line advisory. |
| `git diff --exit-code 3d0001f -- test/ fixtures/ tools/` | 0 | Tests, fixtures and test tools match the packet baseline |

The integrated TAP SHA-256 is `69118686f7ad99115adfca795e653c35f63296cf185484cdf5e5ed9969ce193e`. The direct, repeat and concurrent TAP files are in the evidence directory.

## Visual and boundary evidence

- `sample/replay.html` opens offline. The request trace in `static-requests.json` recorded one file navigation, zero secondary requests and zero console errors.
- `observation.json` indexes loading, running, verified, not reproduced, refused, error, empty, connected live and disconnected views. Every state has a viewport PNG, a full-page PNG showing the timeline and census, and axe JSON at 1280×800 and 390×844 in light and dark. All 36 audits had zero violations. The removed-alt control triggered critical `image-alt`.
- On desktop, equal-width media panes keep the reporter and replay frames comparable. On mobile, the decision and playback controls fit below the replay frame before the reporter recording. In both themes the reason and cost remain readable without covering the frame. The tradeoff is that the phone reader scrolls to compare recordings. Loading and empty screens retain blank media space.
- `live-snapshots.json` records a transition from the first action (123 tokens, 20 µUSD) to the second (561 tokens, 132 µUSD). Disconnect retained the second explanation and 152 µUSD total. Selecting Previous recovered the first explanation and decoded its cached frame.
- The browser displayed markup-like observations as literal text. Schema validation rejects over-limit or non-string action fields. The exporter also refuses credential-shaped fields on disk before writing HTML. The extra boundary check uses the producer's credential shapes because its predicate is private. The previous export survived each rejection byte for byte.
- `export-checks.log` records numeric and status filtering, refusal of linked directories and files, and successful linking to a sibling with unreadable contents. `live-boundary.json` records the unchanged read-only loopback boundary.

## Implementation decisions and limits

The existing player supplies the action match, text-node builder, usage formatting, asset cache and selection controls. The explanation list serves both the selected frame and the timeline. The latest-capture lookup serves both follow detection and selection. The two census helpers separate run-folder projection from the static-only filesystem check. The extra snapshot lines keep validation before serialization on both entry points. The built page retains its single hashed script and existing content security policy.

An early export failed on an absent sibling because this Node version's asynchronous stat call threw for a missing entry. The metadata check now treats an unavailable sibling as unlinked. Visual verification also exercised planned steps arriving before captured actions. Following the most recent capture keeps the selected frame and its explanation together.

The census reflects export time. Re-export after other issues settle to refresh links and statuses. Step usage depends on recorded attribution. The sample explanations and usage are synthetic. BRAN had no native policy in this worktree. Repository inspection supplied the source evidence. Verification used local files and loopback services. No external model call, dependency addition, deployment or push occurred.
