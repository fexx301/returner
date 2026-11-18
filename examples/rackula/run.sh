#!/bin/sh
# Rehearses the Rackula v0.6.16 -> v0.7.0-dev upgrade with Kane, then lets a coding agent repair the candidate
# until Kane passes the returning user from the untouched baseline profile. Usage: examples/rackula/run.sh [codex|claude]
set -eu
cd "$(dirname "$0")/../.."
U=examples/rackula/.upstream
exec node src/repair.mjs --agent "${1:-codex}" --attempts 3 \
  --old "$U/v1" --source "$U/candidate-source" --serve dist \
  --build 'test -d node_modules || npm ci --ignore-scripts --no-audit --no-fund --loglevel=error; npx vite build --logLevel error' \
  --promise "My saved rack layout is still there after the upgrade" \
  --seed 'Create a rack named "{title}" with a height of 24U: in the New Rack dialog or wizard, replace the rack name with "{title}", choose 24U, and create it. Verify a rack named "{title}" is shown on the canvas. Reload the page and verify the rack named "{title}" is still shown.' \
  --check 'Verify that the canvas shows the existing rack named "{title}". This is a read-only check: do not type, do not create a new rack, and do not change anything. The check fails if no rack named "{title}" is shown.' \
  --note "This release changed the saved layout format from a single rack to a racks array. The previous release (v0.6.16) autosaved layouts to localStorage under Rackula:autosave."
