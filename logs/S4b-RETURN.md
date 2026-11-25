# S4b return: locate and BRAN media evidence

Outcome: **PASS** (on the slice's own commit; see "Shared-worktree gate" below).

- Head commit of the slice: `0a877f7` (this return is committed on top of it).
- Date: 2026-11-25. Observer for all results: the S4b Implementer.

## Changed paths

| Path | Change |
| --- | --- |
| `foley-crates/bran-media-evidence/Cargo.toml`, `Cargo.lock` | New standalone crate; only dependency is `vendor/bran/crates/bran-core` by path (zero third-party crates) |
| `foley-crates/bran-media-evidence/README.md` | States the crate is event-built and calls BRAN v0.4.0 unchanged |
| `foley-crates/bran-media-evidence/src/lib.rs` | `locate(repo_root, steps_path) -> Result<String, String>` |
| `foley-crates/bran-media-evidence/src/main.rs` | `bran-media-evidence --repo <dir> --steps <file>` |
| `src/locate.mjs` | `locate(stepsPath, { targetDir, targetRevision, runDir })` |
| `changelog.d/wave-3.md` | One S4b entry appended |

No edit to `test/`, `fixtures/`, test tools, `vendor/bran/` or `package.json`.

## Design as built

- Terms come from step `target` and `value`, and predicate `expected` and
  `observed` (trimmed, at least 2 characters). Steps JSON is size-limited
  (1 MiB) and parsed by a small strict reader in the crate, because
  `vendor/bran` locks no JSON crate.
- BRAN library use: `RepositoryScanner` (read-only, ignore-aware, bounded,
  skips symlinks) supplies the files; `ScanSnapshot::graph_input` and
  `KnowledgeGraph::find` supply the path and metadata evidence used as a
  ranking tie-break.
- Rank: distinct terms on the line (descending), BRAN graph match on the file,
  path, line. At most 20 anchors. No term or no hit gives `status: "miss"`
  with zero anchors.
- `src/locate.mjs` resolves the pinned revision with `git rev-parse`, requires
  `HEAD` to equal it, runs `cargo build --offline` (no-op when current), runs
  the binary with an empty environment, refuses any anchor path that is
  absolute, has `.`/`..`/empty segments, a backslash or NUL, or resolves
  outside the real target root, and checks each anchor line against
  `git cat-file blob <commit>:<file>`. Only then does it write
  `anchors.json` (temporary file and rename).

## Commands and exit codes

| Command | Exit | Result |
| --- | --- | --- |
| Group b gate on a clean clone of `0a877f7` (`out/s4b-gate.log`, sha256 `22bc1518…32ab`) | 0 | BRAN fast gate passed; crate 2/2 tests; locate 2/2; `vendor/bran` diff empty |
| Same gate in the shared worktree | 1 | Lint lane only: peers' uncommitted files (see below) |
| `node --test --test-reporter=tap test/stages/locate` at `b89dd99` | 1 | Red: 2 assertion failures (`out/s4b-red.log`, sha256 `a2056a3b…abac`) |
| `node tools/red-receipt.mjs out/s4b-red.log --expect-ids out/s4b-ids.txt` | 0 | Red receipt for TC-R05-1, TC-R05-2 |
| Same TAP run at `0a877f7`, then `red-receipt.mjs --green … --same-ids out/s4b-red.receipt.json` | 0 / 0 | "all 2 red ids pass" |
| Seeded control: append a line to `vendor/bran/crates/bran-core/src/lib.rs` in the scratch clone, `git diff --exit-code -- vendor/bran` | 1 | Expected failure; restored copy gives 0 |
| `node tools/repeat.mjs 5 test/stages/locate` | 0 | 5/5 passed |
| `node tools/concurrent2.mjs test/stages/locate` | 0 | 2/2 passed |
| `cargo test` on the crate, 5 runs | 0 | 5/5 passed |
| `node tools/check-public.mjs --tree .` | 0 | 383 files, 0 findings |
| `az-lint --changed origin/main` on the clean clone | 0 | cargo-fmt, clippy, biome, gitleaks, semgrep pass |
| `az-simplicity --changed origin/main --format json` | 0 | 35 findings in the tree, 0 in S4b files |
| Scripted check: committed symlink `escape.mjs` pointing outside the target, content matching a term | 0 | No anchor for the symlink; only in-tree anchors returned |
| Scripted check: `targetRevision` `"HEAD~0; rm -rf /"` and unknown `0000000` | refused | Both refused before any scan |

## Acceptance to evidence

| Item | Evidence |
| --- | --- |
| 1. CMD-BRAN cases pass under their ids; green against red | TC-R05-1 and TC-R05-2 red at `b89dd99`, green at `0a877f7`; group receipt pair above |
| 2. Trust boundaries | Target content read only: BRAN scanner reads bytes and skips symlinks; git plumbing only (`rev-parse`, `cat-file`), no hooks or filters; no shell. Model-named files: TC-R05-1 asserts relative, no `..`, resolvable at the revision; the symlink scripted check passes; the Node refusal of escaping paths is in code but has no direct test (see risks) |
| 3. No request leaves loopback | TC-R05-2 runs the JS adapter and binary under `unshare -Urn` and `strace -e trace=network`; no `AF_INET`/`AF_INET6` socket. Cargo runs with `--offline` |
| 4. Other groups not required | Gate exit 0 on a clean clone containing no group a or c modules |

## Failure states (files and processes)

| State | Handling |
| --- | --- |
| Crash during `anchors.json` write | Written to `anchors.json.<pid>.tmp` then renamed; a reader never sees a partial file |
| Concurrent locate runs | Distinct temporary names per process; cargo serialises builds with its target-directory lock; output is deterministic, so the last rename writes identical bytes. Two-copy run passed |
| Retry | Idempotent: same input gives byte-identical `anchors.json` (TC-R05-1) |
| Partial failure (bad steps, scan error, anchor mismatch, dirty tree) | Binary exits non-zero or Node throws before writing; no new `anchors.json` |
| Hung child | `execFileSync` timeout of 120 s kills it and throws |
| Money | Not touched; no model call |

## Shared-worktree gate

In the shared worktree the BRAN fast gate's `az-lint` lane lints every file
changed against `origin/main`, including peers' uncommitted work:
`src/live.mjs`, `src/report.mjs`, `src/run-schema.mjs`, `src/score.mjs`,
`src/watch.mjs`, `ui/build.mjs`, `ui/render.mjs` (biome format) and
`tools/isolate.sh` (shellcheck, shfmt). Those files belong to other slices.
All committed files, including S4b, pass. The gate needs a rerun on the
integrated head after those slices format their files.

## Tests believed wrong

None.

## Amendments

- S4b amendment (2026-11-25): no `package.json` script added; the gate needs none, and `package.json` already carries a peer's uncommitted edit.

## Remaining risks

- Matching is case-sensitive substring matching. On-screen text transformed by
  CSS (for example upper case) will miss.
- Locate refuses a target whose working tree differs from the pinned revision
  at an anchored line, or has an untracked file that matches a term. That is
  intended, but a target with untracked, non-ignored build output fails
  loudly.
- The Node-level path refusal has no committed negative test; only the
  scripted checks above exercise it (test ownership: Test Implementer).

Blocker: none.
