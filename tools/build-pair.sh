#!/usr/bin/env bash
# Builds one bug-and-fix pair of the target (FOL-R07, R15).
# Usage: tools/build-pair.sh <issue> [--commits <bug-sha> <fix-sha>]
# Reads the issue's bug and fix commits from fixtures/pairs/pairs.json unless
# --commits names them (used while a candidate is being assessed). For each
# commit: a detached worktree under out/pairs/<issue>/{bug,fixed} from one
# shared clone, a lockfile install with dependency scripts disabled, a
# supply-chain check of the installed tree (lockfile integrity, then ClamAV),
# and the production build. Fails on an unknown commit, a bug commit that is
# not an ancestor of the fix, a scan finding or a failed build. Writes
# out/pairs/<issue>/receipt.json.
set -euo pipefail

repo_url="https://github.com/excalidraw/excalidraw.git"
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

issue="${1:-}"
case "$issue" in '' | *[!0-9]*)
	echo "usage: tools/build-pair.sh <issue> [--commits <bug-sha> <fix-sha>]" >&2
	exit 2
	;;
esac
shift
bug="" fix=""
if [ "${1:-}" = "--commits" ]; then
	bug="${2:?--commits needs two shas}" fix="${3:?--commits needs two shas}"
elif [ $# -gt 0 ]; then
	echo "build-pair: unknown argument: $1" >&2
	exit 2
else
	# shellcheck disable=SC2016 # single-quoted JavaScript, not shell
	read -r bug fix < <(node -e '
		const pair = require("./fixtures/pairs/pairs.json").pairs.find((p) => p.issue === Number(process.argv[1]));
		if (!pair) { console.error(`build-pair: issue ${process.argv[1]} is not in fixtures/pairs/pairs.json`); process.exit(1); }
		console.log(pair.bug_commit, pair.fix_commit);
	' "$issue")
fi
for sha in "$bug" "$fix"; do
	case "$sha" in *[!0-9a-f]* | "")
		echo "build-pair: commit must be a hex sha: $sha" >&2
		exit 2
		;;
	esac
done

for tool in git yarn npm clamdscan; do
	command -v "$tool" >/dev/null || {
		echo "build-pair: $tool not on PATH" >&2
		exit 1
	}
done

base="out/pairs"
clone="$base/excalidraw.git"
dir="$base/$issue"
mkdir -p "$dir"
[ -d "$clone" ] || git clone --quiet --bare --filter=blob:none "$repo_url" "$clone"

# Resolves a commit, fetching it once if the shared clone lacks it.
resolve() {
	if ! git -C "$clone" cat-file -e "$1^{commit}" 2>/dev/null; then
		git -C "$clone" fetch --quiet --filter=blob:none origin "$1" 2>/dev/null || true
	fi
	git -C "$clone" rev-parse --verify --quiet "$1^{commit}" || {
		echo "build-pair: unknown commit $1 in $repo_url" >&2
		exit 1
	}
}
bug="$(resolve "$bug")"
fix="$(resolve "$fix")"
git -C "$clone" merge-base --is-ancestor "$bug" "$fix" || {
	echo "build-pair: bug commit $bug is not an ancestor of fix commit $fix" >&2
	exit 1
}

clam_db="$(clamscan --version 2>/dev/null | sed -n 's#^ClamAV [^/]*/\([0-9]*\)/\(.*\)$#\1 \2#p')"

# build SIDE SHA: worktree, frozen install, scan, build. Prints a JSON record.
build() {
	local side="$1" sha="$2" tree="$dir/$1" log="$dir/$1"
	if [ ! -e "$tree/.git" ]; then
		rm -rf "$tree"
		git -C "$clone" worktree add --quiet --detach "$root/$tree" "$sha"
	fi
	[ "$(git -C "$tree" rev-parse HEAD)" = "$sha" ] || {
		echo "build-pair: $tree is not at $sha" >&2
		exit 1
	}
	# Frozen lockfile: yarn refuses a lockfile change and checks each package's
	# integrity hash. Dependency install scripts never run. Older commits declare
	# Node 18-20; the declared range is recorded and the build runs on this Node.
	(cd "$tree" && yarn install --frozen-lockfile --ignore-scripts --ignore-engines --non-interactive) \
		>"$log-install.log" 2>&1 || {
		echo "build-pair: $side install failed, see $log-install.log" >&2
		exit 1
	}
	(cd "$tree" && yarn check --integrity --ignore-scripts --ignore-engines) >"$log-integrity.log" 2>&1 || {
		echo "build-pair: $side lockfile integrity check failed, see $log-integrity.log" >&2
		exit 1
	}
	# ClamAV over the installed dependency tree; exit 1 means a detection.
	local scan=0
	clamdscan --fdpass --multiscan --infected "$tree/node_modules" >"$log-clamav.log" 2>&1 || scan=$?
	if [ "$scan" -ne 0 ]; then
		echo "build-pair: $side ClamAV $([ "$scan" -eq 1 ] && echo BLOCK || echo INDETERMINATE), see $log-clamav.log" >&2
		exit 1
	fi
	# A hung build (seen once: a 2024 Vite checker plugin kept running ESLint
	# after the bundle was written) fails after 15 minutes.
	timeout 900 npm --prefix "$tree" run build >"$log-build.log" 2>&1 || {
		echo "build-pair: $side build failed or timed out, see $log-build.log" >&2
		exit 1
	}
	[ -f "$tree/excalidraw-app/build/index.html" ] || {
		echo "build-pair: $side build has no excalidraw-app/build/index.html" >&2
		exit 1
	}
	printf '{"side":"%s","commit":"%s","declared_node":"%s","built_with_node":"%s","yarn_lock_sha256":"%s","dependency_files":%s,"infected_files":%s,"page":"%s"}' \
		"$side" "$sha" "$(node -p "require('./$tree/package.json').engines?.node ?? 'unstated'")" "$(node --version)" \
		"$(sha256sum "$tree/yarn.lock" | cut -d' ' -f1)" \
		"$(find "$tree/node_modules" -type f | wc -l)" \
		"$(sed -n 's/^Infected files: //p' "$log-clamav.log")" "$tree/excalidraw-app/build"
}

bug_record="$(build bug "$bug")"
fix_record="$(build fixed "$fix")"
cat >"$dir/receipt.json" <<EOF
{
  "issue": $issue,
  "built_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "clamav_database": "$clam_db",
  "scan_verdict": "PASS",
  "scan_basis": "yarn frozen-lockfile install with per-package integrity hashes, yarn check --integrity, install scripts disabled, clamdscan over node_modules with no detection",
  "builds": [$bug_record, $fix_record]
}
EOF
echo "build-pair: OK issue $issue, bug $bug and fix $fix built under $dir"
