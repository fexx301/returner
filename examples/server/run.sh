#!/bin/sh
# Quillpad: a server-rendered Node app (no build, no dependencies) whose draft lives in a cookie. Its v2 stores the
# cookie in a new format and answers 500 to every returning user. This starts v1, then lets a coding agent repair v2;
# Returner starts each candidate itself and proxies both apps through one origin.
# Usage: examples/server/run.sh [codex|claude]
set -eu
cd "$(dirname "$0")/../.."
PORT=4101 node examples/server/v1/server.mjs &
OLD=$!
trap 'kill $OLD' EXIT INT TERM
until curl -s -o /dev/null http://127.0.0.1:4101/; do sleep 0.2; done
node src/repair.mjs --agent "${1:-codex}" --attempts 3 \
  --old http://127.0.0.1:4101 --source examples/server/v2-broken \
  --start 'PORT=4102 node server.mjs' --serve http://127.0.0.1:4102 \
  --promise "My draft survives the release" \
  --reference examples/server/v1/server.mjs \
  --note "This is a server-rendered Node app: server.mjs, no build and no dependencies. Returner starts it with PORT=4102 node server.mjs. The previous release's server.mjs is the reference file."
