# S5p return: real bug-and-fix build pairs

Author: the S5p Implementer. Date: 2026-11-25. Branch `wave-4`. Not pushed. No
model call was made and nothing was posted upstream.

## Outcome: PASS

Three real Excalidraw bugs have a reporter recording, a bug commit and a fix
commit, both built and served locally. On each, a scripted check shows the
wrong behaviour on the bug build and the right behaviour on the fixed build, and
`prove` reaches `verified` offline with the real builds. The aim was six; four
more candidates were assessed and excluded (listed below).

## Pairs

| Pair | Bug commit | Fix commit | Check exits, bug ×3 / fixed ×3 | Offline `prove` | Scan verdict |
| --- | --- | --- | --- | --- | --- |
| [#10840](https://github.com/excalidraw/excalidraw/issues/10840) hand tool after view mode and laser | 2874f9e4 | cae9d2bc ([#10841](https://github.com/excalidraw/excalidraw/pull/10841)) | 1 1 1 / 0 0 0 | `verified` (4 of 4 runs) | PASS |
| [#9852](https://github.com/excalidraw/excalidraw/issues/9852) eraser shortcut during line creation | 4ce70b81 | cce5001a ([#11571](https://github.com/excalidraw/excalidraw/pull/11571)) | 1 1 1 / 0 0 0 | `verified` (4 of 4 runs) | PASS |
| [#8418](https://github.com/excalidraw/excalidraw/issues/8418) copy to clipboard gives no feedback | afb68a64 | 26d22965 ([#8426](https://github.com/excalidraw/excalidraw/pull/8426)) | 1 1 1 / 0 0 0 | `verified` (3 of 3 runs) | PASS |

Every fix pull request was squash-merged, so each fix commit has a single
parent, which is the bug commit. `tools/build-pair.sh` also checks that the bug
commit is an ancestor of the fix commit.

Scan basis, per side of each pair:
- `yarn install --frozen-lockfile --ignore-scripts` (per-package integrity
  hashes from `yarn.lock`, no install scripts);
- `yarn check --integrity`;
- `clamdscan` over `node_modules`: 0 infected, with 57,728 to 70,901 files per
  tree.

The ClamAV database is 28188, dated 2026-11-19 (six days old); `freshclam`
needs sudo, so it was not refreshed. Receipts are in `out/pairs/<issue>/receipt.json`.

None of the three is in the held-out or tuning set. I read the held-out list
only for its issue numbers, to exclude them.

## Demo ranking

1. **#9852:** three actions (L, one click, E). The toolbar visibly highlights
   the eraser on the bug build and keeps the line tool on the fixed build. 2026
   code, 23 s recording.
2. **#10840:** four key presses. The toolbar shows the hand tool instead of the
   selection tool. 2026 code, 24 s recording.
3. **#8418:** the shortest recording (4 s), but the wrong result is an absence
   (no "copied" state). The 2024 commits declare Node 18 to 20, and the build
   takes several minutes because of its ESLint checker.

## Commands and exit codes

| Command | Exit | Result |
| --- | --- | --- |
| `tools/build-pair.sh 10840`, `9852` (from `pairs.json`) | 0, 0 | 45 s and 48 s with a warm cache |
| `tools/build-pair.sh 8418` | see note | First build exit 0. A rebuild hung in the 2024 Vite ESLint checker after the bundle was written; I killed it at 976 s and added a 900 s build timeout. A final rebuild was still running when this return was committed; every 8418 check and proof above used the first successful build. |
| `tools/build-pair.sh 1 --commits 0123…4567 cae9d2bc…` | 1 | `build-pair: unknown commit 0123456789abcdef0123456789abcdef01234567` |
| `tools/build-pair.sh 424242` | 1 | `issue 424242 is not in fixtures/pairs/pairs.json` |
| `node test/pairs/check.mjs <issue> bug` / `fixed`, three runs each | 1 / 0 | All three pairs, every run |
| `node test/pairs/prove-pair.mjs <issue>` | 0 | `verified` for all three pairs, on every run |
| `FOLEY_OFFLINE=1 node --test test/ember/` | 0 | 50 pass |
| `FOLEY_OFFLINE=1 node --test --test-concurrency=1 test/stages/` | 0 | 22 pass |
| `node --test test/ui/` | 0 | 4 pass, after `npm run build:ui` |
| `FOLEY_OFFLINE=1 node --test test/e2e/` | 0 | 2 pass |
| `FOLEY_OFFLINE=1 node --test test/s4x/*.test.mjs` | 0 | 6 pass |
| `FOLEY_OFFLINE=1 node --test --test-concurrency=1 test/w3r/*.test.mjs` | 0 | 40 pass, with `FOLEY_EXCALIDRAW_TARGET` set to the pinned target |
| `npm run demo:offline` | 0 | |
| `node tools/check-fixtures.mjs fixtures/` | 0 | 0 failed |
| `node tools/check-public.mjs --tree .` | 0 | 448 files, 0 findings |
| `az-lint --changed main` | 0 | |
| `az-simplicity --changed main --format json` (advisory) | 0 | 10 files checked, 0 findings |

Environment notes for the earlier suites in a fresh worktree: the w3r tests
need `FOLEY_EXCALIDRAW_TARGET` (default `out/w3r-excalidraw`, which a new
worktree lacks), and TC-R04-5 needs `npm run build:ui` first. Neither is a
product change.

## Product defects fixed (item 4)

The first real pair could not reach `verified`. Each defect below has a
red-then-green check: the same unchanged command, red before the fix and green
after.

| Defect | Fix commit | Red | Green |
| --- | --- | --- | --- |
| `tools/isolate.sh` starts Vitest with an empty environment and no passwd entry. Vite calls `os.homedir()` at start, so every real Vitest target failed with `uv_os_homedir returned ENOENT` before any test ran. | 55cefa4: `HOME=/tmp`, the sandbox tmpfs | The isolated #10840 run errors on both builds | The test fails on the bug build and passes on the fixed build |
| `prove` served each checkout root to the page control. An Excalidraw checkout has no `index.html` there (the build is `excalidraw-app/build`), so real proofs could only be `inconclusive` (the W3R-P remaining risk). | dbfadee: `pageDirs` option, defaulting to the checkouts | `prove-pair.mjs 10840` gives `inconclusive` | `verified` |
| `failureMessages` matched only single-line Vitest messages. A Testing Library `waitFor` failure writes a multi-line message, so a real assertion failure was classed `test_error`. | 0b96804: take the message's first line | `prove-pair.mjs 8418` gives `test_error` | `verified` |

The existing prove suites (`test/stages/prove`, `test/w3r/P.test.mjs`) pass
18 of 18 after these changes.

## Excluded candidates

| Issue | Reason |
| --- | --- |
| #8840 reset canvas crash | Built both commits; it does not reproduce in Playwright's Chromium. The report ties it to a specific Chrome/Arc version, so it is not deterministic here. Its builds were removed. |
| #8295 z-index freeze | Needs a text-bound container, which takes a pointer drag; Foley's recorded-step driver has selector actions only, so the proof control cannot replay it. Its builds were removed. |
| #11759 Escape exits fullscreen | Screenshot, not a recording; fullscreen cannot be observed headless. |
| #11817 change-arrow error after paste | Screenshot, not a recording; needs right-click and the clipboard. |
| #10772 hex8 colour regression | Screenshot only; no reporter recording. |
| #10867 eyedropper in dark theme | The fix is a bundled feature pull request ("eyedropper fixes and improvements"), and the pick depends on pointer position. |
| #8558 text disappears after colour picker | The reporter says it is consistent on Safari and seen once on Chrome: intermittent. |
| Census issues 9509, 12405 and 9938 (tuning set) | Fixed upstream but still open; finding each fix commit needs a bisect, and none was attempted within the time limit. |

## Changed paths

- `tools/build-pair.sh` (new)
- `test/pairs/check.mjs`, `test/pairs/state.mjs`,
  `test/pairs/prove-pair.mjs`, and one scenario per pair:
  `test/pairs/10840.mjs`, `test/pairs/9852.mjs`, `test/pairs/8418.mjs`
- `fixtures/pairs/pairs.json`,
  `fixtures/pairs/tests/{10840,9852,8418}/regression.test.mjs`
- `src/prove.mjs`, `tools/isolate.sh` (item 4 fixes)
- `media/PROVENANCE.json` (three external recordings; URL, size and hash only)
- `changelog.d/wave-4.md`, `logs/S5p-RETURN.md`

`.gitignore` is unchanged, because `out/` is already ignored. No third-party
media or target source is committed.

## Disk

`out/pairs` holds 7.2 GB:
- three pairs at about 2.4 GB each (two checkouts with dependencies and builds);
- the shared blobless clone, 49 MB;
- recordings, about 13 MB.

The excluded candidates' builds (about 5.3 GB) were removed. The three kept
pairs are needed for the proof runs and the demo, so remove them only after the
demo.

## Remaining risks

1. **`foley run` cannot prove these pairs yet.** Its pin check expects the
   census revision, and it has no option for built page directories. The pairs
   are proved through `prove` directly (`test/pairs/prove-pair.mjs`). Wiring
   pairs into the CLI is a follow-up.
2. **The page control relies on readiness and wait steps.** It replays the
   recorded steps with no readiness wait, so each pair's steps start by
   hovering the main menu and end with a short `wait`, because Excalidraw saves
   state to local storage on a debounce.
3. **The 2024 pair builds slowly and is not on its declared Node.** #8418
   declares Node 18 to 20 and was built on 22.23.4 with `--ignore-engines`.
   Its Vite ESLint checker made one rebuild hang; the build now times out at
   900 s.
4. **The ClamAV database is six days old.** Refreshing it needs sudo.
5. **Only three pairs.** Further pairs would need drag or right-click steps,
   which Foley's recorded-step driver does not support.

## Blocker

None.
