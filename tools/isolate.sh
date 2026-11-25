#!/bin/sh
# Runs one untrusted Node test file with no network, a confined file view and
# time and memory limits (DES-FOL-R07).
# Usage: isolate.sh NODE WORKDIR HEAP_MIB TIMEOUT_S FILE
#
# New user, mount, PID and network namespaces: loopback is down, /proc shows only
# the sandbox, and home, temp and runtime-socket directories are empty tmpfs. The
# work directory is copied into a size-capped tmpfs, so nothing the test writes
# reaches the host disk. The process starts with an empty environment. The Node
# permission model limits file access to the work copy and denies child
# processes, workers and addons. The data-segment limit is the effective memory
# cap: V8 exceeds --max-old-space-size for one large allocation. TIMEOUT_S is a
# backstop if the caller dies; the caller enforces the real time limit.
set -eu
[ "$#" -eq 5 ] || {
	echo "usage: isolate.sh NODE WORKDIR HEAP_MIB TIMEOUT_S FILE" >&2
	exit 2
}
for n in "$3" "$4"; do
	case $n in '' | *[!0-9]*)
		echo "isolate.sh: HEAP_MIB and TIMEOUT_S must be integers" >&2
		exit 2
		;;
	esac
done
case $5 in '' | */* | .*)
	echo "isolate.sh: FILE must be a plain file name" >&2
	exit 2
	;;
esac
# shellcheck disable=SC2016 # the inner script expands its own positional arguments
exec unshare --user --map-root-user --net --mount --pid --fork --kill-child --mount-proc \
	sh -eu -c '
		node=$1 work=$2 heap=$3 limit=$4 file=$5
		mount -t tmpfs -o size=1m,mode=755 foley-sandbox /mnt
		mkdir /mnt/work
		: > /mnt/node
		mount --bind -o ro "$node" /mnt/node
		mount -t tmpfs -o size=256m foley-work /mnt/work
		cp -R "$work"/. /mnt/work/
		for dir in /home /root /tmp /var/tmp /run /media /srv /opt; do
			[ -d "$dir" ] && mount -t tmpfs -o size=1m foley-hidden "$dir"
		done
		cd /mnt/work
		ulimit -c 0
		# Runtime baseline is about 50 MiB of data; 64 MiB covers it.
		ulimit -d $(( (heap + 64) * 1024 ))
		exec timeout -s KILL "$limit" env -i /mnt/node --permission \
			--allow-fs-read=/mnt/work --allow-fs-write=/mnt/work \
			--max-old-space-size="$heap" --test-reporter=tap "$file"
	' sh "$1" "$2" "$3" "$4" "$5"
