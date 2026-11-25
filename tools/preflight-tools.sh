#!/usr/bin/env bash
# Preflight for external tools (CMD-PRE-TOOLS). Writes out/preflight/tools.json.
# Exits non-zero and names every missing or broken tool.
set -uo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root" || exit 2
out="out/preflight/tools.json"
mkdir -p "$(dirname "$out")"

records=()
failed=()

sha_of() { [ -n "$1" ] && [ -f "$1" ] && sha256sum "$1" | cut -d' ' -f1; }

# check NAME HASH_FILE CMD... : runs CMD, keeps its first output line as the version.
check() {
	local name="$1" file="$2"
	shift 2
	local text status
	text="$("$@" 2>&1 </dev/null)"
	status=$?
	if [ "$status" -ne 0 ]; then
		failed+=("$name (exit $status: $(printf '%s' "$text" | head -n1))")
		return
	fi
	records+=("$(node -e 'const [n,v,s]=process.argv.slice(1);process.stdout.write(JSON.stringify({name:n,version:v,sha256:s||null}))' \
		"$name" "$(printf '%s' "$text" | head -n1)" "$(sha_of "$file")")")
}

# bin NAME CMD... : tool found on PATH, hashed at its resolved file.
bin() {
	local name="$1"
	shift
	local path
	if ! path="$(command -v "$1")"; then
		failed+=("$name (not on PATH)")
		return
	fi
	check "$name" "$(readlink -f "$path")" "$@"
}

bin node node --version
bin npm npm --version
bin yarn yarn --version
bin ffmpeg ffmpeg -hide_banner -version
bin ffprobe ffprobe -hide_banner -version
bin cargo cargo --version
bin gitleaks gitleaks version
# az-lint has no --version flag: -h proves it runs; the file hash pins it.
if path="$(command -v az-lint)"; then
	check az-lint "$(readlink -f "$path")" sh -c 'az-lint -h >/dev/null && echo "unversioned (no --version flag)"'
else
	failed+=("az-lint (not on PATH)")
fi

pw_cli="node_modules/playwright/cli.js"
if [ -f "$pw_cli" ]; then
	check playwright "$pw_cli" npx --no-install playwright --version
	# Dry run names the pinned Chromium; the browser must also be installed.
	dry="$(npx --no-install playwright install --dry-run chromium 2>&1)"
	loc="$(printf '%s\n' "$dry" | awk '/Chrome for Testing/{f=1} f&&/Install location:/{print $3; exit}')"
	bin_path="$loc/chrome-linux64/chrome"
	if [ -n "$loc" ] && [ -x "$bin_path" ]; then
		check playwright-chromium "$bin_path" sh -c "printf '%s\n' \"\$1\" | head -n1" _ "$dry"
	else
		failed+=("playwright-chromium (not installed; run: npx playwright install chromium)")
	fi
else
	failed+=("playwright (node_modules missing; run: npm ci)")
fi

axe="node_modules/@axe-core/playwright/package.json"
if [ -f "$axe" ]; then
	check axe-core-playwright "$axe" node -p "require('./$axe').version"
else
	failed+=("axe-core-playwright (node_modules missing; run: npm ci)")
fi

# Target runner as pinned in fixtures/target.json by tools/target-pin.sh.
if [ -f fixtures/target.json ]; then
	runner_cmd="$(node -p "require('./fixtures/target.json').runner.version_command")"
	runner_file="$(node -p "require('./fixtures/target.json').runner.entry")"
	check target-runner "$runner_file" sh -c "$runner_cmd"
else
	failed+=("target-runner (fixtures/target.json missing; run: tools/target-pin.sh --record fixtures/target.json)")
fi

# BRAN's CI entry point prints usage and exits 2 for --help; usage text proves it runs.
# shellcheck disable=SC2016 # single quotes are intended: the inner script expands its own variables
check bran-ci "vendor/bran/tools/ci/check.sh" \
	sh -c 'cd vendor/bran && t="$(./tools/ci/check.sh --help 2>&1)"; case "$t" in usage:*) printf "%s\n" "$t";; *) printf "%s\n" "$t"; exit 1;; esac'

# shellcheck disable=SC2016 # single-quoted JavaScript, not shell
node -e '
const fs = require("fs");
const [out, ok, ...rest] = process.argv.slice(1);
const sep = rest.indexOf("--");
const tools = rest.slice(0, sep).map((r) => JSON.parse(r));
const missing = rest.slice(sep + 1);
fs.writeFileSync(out, JSON.stringify({
  generated_at: new Date().toISOString(),
  host: { platform: process.platform, arch: process.arch },
  ok: ok === "1", tools, missing,
}, null, 2) + "\n");
' "$out" "$([ ${#failed[@]} -eq 0 ] && echo 1 || echo 0)" "${records[@]}" -- "${failed[@]}"

if [ ${#failed[@]} -ne 0 ]; then
	printf 'preflight: FAIL, missing or broken:\n' >&2
	printf '  %s\n' "${failed[@]}" >&2
	exit 1
fi
printf 'preflight: OK, %d tools, see %s\n' "${#records[@]}" "$out"
