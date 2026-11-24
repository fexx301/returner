#!/bin/sh
# Rehearses the PKIMM 1.0.0 -> 1.1.0 release with Kane using two distinct returning-user profiles
# configured in examples/pkimm/returner.json:
#   Profile A: Strategy and Vision = 3 - Advanced, Infrastructure management = 4 - Managed, Sourcing = 2 - Basic
#   Profile B (holdout, outside the agent workspace): Strategy and Vision = 5 - Optimized,
#              Infrastructure management = 1 - Initial (app default, left untouched), Sourcing = 4 - Managed
# A repair passes only if both returning users keep their own answers after a reload, see Cryptography,
# and pass a fresh rehearsal with a new marker. Usage: examples/pkimm/run.sh [codex|claude]
set -eu
cd "$(dirname "$0")/../.."
exec node src/repair.mjs --config examples/pkimm/returner.json --agent "${1:-codex}"
