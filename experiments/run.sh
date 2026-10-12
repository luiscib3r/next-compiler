#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "$0")" && pwd)"
echo "== 01-bunfs-resolve =="
bash "$root/01-bunfs-resolve/run.sh"
echo "== 02-bunfs-fs =="
bash "$root/02-bunfs-fs/run.sh"
echo "== 03-worker-postmessage =="
bash "$root/03-worker-postmessage/run.sh"
echo "== 04-cache-handler-shim =="
bash "$root/04-cache-handler-shim/run.sh"
