#!/bin/sh
# Runs one untrusted test file with the target's own runner, no network, a
# confined file view and time and memory limits (DES-FOL-R07).
# Usage: isolate.sh RUNNER NODE TARGET CANDIDATE HEAP_MIB TIMEOUT_S FILE
#   RUNNER     node-test or vitest
#   TARGET     target checkout, never written (read-only lower layer)
#   CANDIDATE  directory holding FILE, layered over TARGET
#
# New user, mount, PID and network namespaces: loopback is down, /proc shows only
# the sandbox, and home, temp and runtime-socket directories are empty tmpfs.
# The work tree is an overlay of CANDIDATE over TARGET whose writable layer is a
# size-capped tmpfs, so nothing the test writes reaches the host disk and the
# target needs no copy. The process starts with an empty environment.
# node-test also runs under the Node permission model (file access limited to
# the work tree; no child processes, workers or addons). Vitest needs child
# processes, workers and native addons, which void that model, so it relies on
# the namespaces and the mount view alone.
# The data-segment limit is the effective memory cap: V8 exceeds
# --max-old-space-size for one large allocation. TIMEOUT_S is a backstop if the
# caller dies; the caller enforces the real time limit.
set -eu
[ "$#" -eq 7 ] || {
	echo "usage: isolate.sh RUNNER NODE TARGET CANDIDATE HEAP_MIB TIMEOUT_S FILE" >&2
	exit 2
}
case $1 in node-test | vitest) ;; *)
	echo "isolate.sh: unsupported runner" >&2
	exit 2
	;;
esac
for n in "$5" "$6"; do
	case $n in '' | *[!0-9]*)
		echo "isolate.sh: HEAP_MIB and TIMEOUT_S must be integers" >&2
		exit 2
		;;
	esac
done
case $7 in '' | */* | .*)
	echo "isolate.sh: FILE must be a plain file name" >&2
	exit 2
	;;
esac
# shellcheck disable=SC2016 # the inner script expands its own positional arguments
exec unshare --user --map-root-user --net --mount --pid --fork --kill-child --mount-proc \
	sh -eu -c '
		runner=$1 node=$2 target=$3 candidate=$4 heap=$5 limit=$6 file=$7
		mount -t tmpfs -o size=1m,mode=755 foley-sandbox /mnt
		mkdir /mnt/work /mnt/rw
		: > /mnt/node
		mount --bind -o ro "$node" /mnt/node
		mount -t tmpfs -o size=256m foley-rw /mnt/rw
		mkdir /mnt/rw/upper /mnt/rw/scratch
		mount -t overlay foley-work \
			-o "lowerdir=$candidate:$target,upperdir=/mnt/rw/upper,workdir=/mnt/rw/scratch" /mnt/work
		for dir in /home /root /tmp /var/tmp /run /media /srv /opt; do
			[ -d "$dir" ] && mount -t tmpfs -o size=1m foley-hidden "$dir"
		done
		cd /mnt/work
		ulimit -c 0
		# Runtime baseline is about 50 MiB of data; 64 MiB covers it.
		ulimit -d $(( (heap + 64) * 1024 ))
		if [ "$runner" = node-test ]; then
			exec timeout -s KILL "$limit" env -i /mnt/node --permission \
				--allow-fs-read=/mnt/work --allow-fs-write=/mnt/work \
				--max-old-space-size="$heap" --test-reporter=tap "$file"
		fi
		exec timeout -s KILL "$limit" env -i PATH=/usr/bin:/bin /mnt/node \
			--max-old-space-size="$heap" node_modules/vitest/vitest.mjs run "$file" \
			--cache=false --reporter=tap-flat --no-color
	' sh "$1" "$2" "$3" "$4" "$5" "$6" "$7"
