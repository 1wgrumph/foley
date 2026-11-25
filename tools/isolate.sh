#!/bin/sh
# Runs one untrusted test file with the target's own runner, no network, a
# confined file view and time and memory limits (DES-FOL-R07).
# Usage: isolate.sh RUNNER NODE TARGET CANDIDATE HEAP_MIB TIMEOUT_S FILE
#   RUNNER     node-test or vitest
#   TARGET     target checkout, never written (read-only lower layer)
#   CANDIDATE  directory holding FILE, layered over TARGET
#
# New user, mount, PID and network namespaces, then a pivot into a minimal root:
# read-only /usr, the read-only node binary, a private /proc, /dev/null and
# random devices, a tmpfs /tmp, and /work. The host root is unmounted, so no
# other host path is reachable. Loopback is down. /work is an overlay of
# CANDIDATE over TARGET whose writable layer is a size-capped tmpfs, so nothing
# the test writes reaches the host disk and the target needs no copy. The test
# starts with an empty environment, no capabilities and no-new-privileges.
# node-test also runs under the Node permission model (file access limited to
# /work; no child processes, workers or addons). Vitest needs child processes,
# workers and native addons, which void that model; it relies on the pivoted
# root and the namespaces.
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
		root=/mnt
		mount -t tmpfs -o size=1m,mode=755 foley-root "$root"
		mkdir "$root/usr" "$root/work" "$root/rw" "$root/tmp" "$root/proc" \
			"$root/dev" "$root/etc" "$root/old"
		# Vitest resolves localhost; nothing else of the host /etc is visible.
		printf "127.0.0.1 localhost\n::1 localhost\n" > "$root/etc/hosts"
		echo "hosts: files" > "$root/etc/nsswitch.conf"
		for link in bin lib lib64 sbin; do ln -s "usr/$link" "$root/$link"; done
		mount --rbind /usr "$root/usr"
		mount -o remount,bind,ro "$root/usr"
		: > "$root/node"
		mount --bind "$node" "$root/node"
		mount -o remount,bind,ro "$root/node"
		for dev in null zero random urandom; do
			: > "$root/dev/$dev"
			mount --bind "/dev/$dev" "$root/dev/$dev"
		done
		mount -t tmpfs -o size=256m foley-rw "$root/rw"
		mkdir "$root/rw/upper" "$root/rw/scratch"
		mount -t overlay foley-work \
			-o "lowerdir=$candidate:$target,upperdir=$root/rw/upper,workdir=$root/rw/scratch" \
			"$root/work"
		mount -t tmpfs -o size=16m foley-tmp "$root/tmp"
		mount -t proc proc "$root/proc"
		cd "$root"
		pivot_root . old
		umount -l /old
		rmdir /old
		cd /work
		ulimit -c 0
		# Runtime baseline is about 50 MiB of data; 64 MiB covers it.
		ulimit -d $(( (heap + 64) * 1024 ))
		drop="setpriv --no-new-privs --bounding-set=-all --inh-caps=-all"
		if [ "$runner" = node-test ]; then
			exec timeout -s KILL "$limit" $drop env -i /node --permission \
				--allow-fs-read=/work --allow-fs-write=/work \
				--max-old-space-size="$heap" --test-reporter=tap "$file"
		fi
		# Vite reads the home directory at start; /tmp is the sandbox tmpfs.
		exec timeout -s KILL "$limit" $drop env -i PATH=/usr/bin HOME=/tmp /node \
			--max-old-space-size="$heap" node_modules/vitest/vitest.mjs run "$file" \
			--cache=false --reporter=tap-flat --no-color
	' sh "$1" "$2" "$3" "$4" "$5" "$6" "$7"
