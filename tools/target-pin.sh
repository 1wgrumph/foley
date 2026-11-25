#!/usr/bin/env bash
# Pin, build and smoke-start the target app (CMD-TARGET).
# Usage: tools/target-pin.sh --record fixtures/target.json [--commit <sha>]
# Clones excalidraw/excalidraw into target/ (ignored by Git), checks out the
# pinned commit, installs with the lockfile, builds, starts the build once on a
# loopback port chosen by the system, and records the result.
set -euo pipefail

repo_url="https://github.com/excalidraw/excalidraw.git"
# Pinned 2026-11-24: default-branch head at preflight; builds with yarn 1.22.22.
commit="eaa7fa32a6645ae9da57eda548e838d0e2a024a1"
record=""

while [ $# -gt 0 ]; do
	case "$1" in
	--record)
		record="${2:?--record needs a path}"
		shift 2
		;;
	--commit)
		commit="${2:?--commit needs a sha}"
		shift 2
		;;
	*)
		echo "target-pin: unknown argument: $1" >&2
		exit 2
		;;
	esac
done
[ -n "$record" ] || {
	echo "target-pin: --record <file> is required" >&2
	exit 2
}
case "$commit" in
*[!0-9a-f]* | "")
	echo "target-pin: commit must be a hex sha: $commit" >&2
	exit 2
	;;
esac

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"
log_dir="out/preflight"
mkdir -p "$log_dir"

if [ ! -d target/.git ]; then
	git clone --filter=blob:none "$repo_url" target
fi
if ! git -C target cat-file -e "${commit}^{commit}" 2>/dev/null; then
	git -C target fetch --filter=blob:none origin "$commit" ||
		{
			echo "target-pin: unknown commit $commit in $repo_url" >&2
			exit 1
		}
fi
full="$(git -C target rev-parse --verify "${commit}^{commit}")" ||
	{
		echo "target-pin: unknown commit $commit" >&2
		exit 1
	}
git -C target checkout --quiet --detach "$full"

command -v yarn >/dev/null || {
	echo "target-pin: yarn not on PATH (target needs yarn 1.22.22)" >&2
	exit 1
}
# Lockfile install; dependency install scripts stay off (the build does not need them).
(cd target && yarn install --frozen-lockfile --ignore-scripts --non-interactive) >"$log_dir/target-install.log" 2>&1 ||
	{
		echo "target-pin: install failed, see $log_dir/target-install.log" >&2
		exit 1
	}

build_cmd="npm --prefix target run build"
$build_cmd >"$log_dir/target-build.log" 2>&1 ||
	{
		echo "target-pin: build failed, see $log_dir/target-build.log" >&2
		exit 1
	}

runner_entry="target/node_modules/vitest/vitest.mjs"
runner_version_cmd="target/node_modules/.bin/vitest --version"
runner_out="$($runner_version_cmd)"
runner_version="$(printf '%s' "$runner_out" | sed -n 's#^vitest/\([0-9.]*\).*#\1#p')"
[ -n "$runner_version" ] || {
	echo "target-pin: cannot read vitest version: $runner_out" >&2
	exit 1
}

# Start the built app once on a system-chosen loopback port and fetch the page.
start_cmd="cd target/excalidraw-app && ../node_modules/.bin/vite preview --host 127.0.0.1 --port 0 --strictPort"
start_log="$log_dir/target-start.log"
setsid bash -c "$start_cmd" >"$start_log" 2>&1 &
server=$!
trap 'kill -- -"$server" 2>/dev/null || true' EXIT
origin=""
for _ in $(seq 1 60); do
	origin="$(sed 's/\x1b\[[0-9;]*m//g' "$start_log" | grep -o 'http://127\.0\.0\.1:[0-9]*' | head -n1 || true)"
	[ -n "$origin" ] && break
	kill -0 "$server" 2>/dev/null || break
	sleep 1
done
[ -n "$origin" ] || {
	echo "target-pin: app did not start, see $start_log" >&2
	exit 1
}
curl -fsS "$origin/" | grep -q '<title>Excalidraw' ||
	{
		echo "target-pin: $origin did not serve the Excalidraw page" >&2
		exit 1
	}
kill -- -"$server" 2>/dev/null || true
trap - EXIT

mkdir -p "$(dirname "$record")"
# shellcheck disable=SC2016 # single-quoted JavaScript, not shell
node -e '
const fs = require("fs");
const [file, repo, commit, build, runnerVersion, runnerEntry, runnerCmd, start, yarnVersion] = process.argv.slice(1);
fs.writeFileSync(file, JSON.stringify({
  repository: repo,
  commit,
  pinned_on: "2026-11-24",
  package_manager: `yarn@${yarnVersion}`,
  install_command: "cd target && yarn install --frozen-lockfile --ignore-scripts",
  build_command: build,
  runner: { name: "vitest", version: runnerVersion, entry: runnerEntry, version_command: runnerCmd },
  start_command: start,
  origin: "http://127.0.0.1:<port chosen by the system at start>",
}, null, 2) + "\n");
' "$record" "$repo_url" "$full" "$build_cmd" "$runner_version" "$runner_entry" "$runner_version_cmd" "$start_cmd" "$(yarn --version)"

echo "target-pin: OK $full built, served at $origin, recorded in $record"
