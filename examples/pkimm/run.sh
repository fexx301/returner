#!/bin/sh
# Rehearses the PKIMM 1.0.0 -> 1.1.0 release with Kane, then lets a coding agent repair widget v1.0.3 until
# Kane passes the returning user from the untouched baseline profile. Usage: examples/pkimm/run.sh [codex|claude]
set -eu
cd "$(dirname "$0")/../.."
U=examples/pkimm/.upstream
exec node src/repair.mjs --agent "${1:-codex}" --attempts 3 \
  --old "$U/v1" --source "$U/candidate-source" --serve site \
  --build 'test -d node_modules || npm ci --no-audit --no-fund --loglevel=error; npm run build --silent && cp dist/self-assessment.js site/' \
  --promise "My saved assessment survives the model update, and I see the new model" \
  --seed 'Open the Report tab. Type "{title}" into the Assessment Name field and "{body}" into the Assessor Name field. Open the Governance tab and select level "3 - Advanced" for "Strategy and Vision". Reload the page, open the Report tab and verify the Assessment Name is exactly "{title}" and the Assessor Name is exactly "{body}".' \
  --check 'Open the Report tab and verify the Assessment Name is exactly "{title}" and the Assessor Name is exactly "{body}". Then open the Governance tab. Verify that "Strategy and Vision" is still at level "3 - Advanced" and that the Governance module lists a category named "Cryptography". If a saved value is missing or Cryptography is not listed, fail immediately without typing, selecting or recreating anything.' \
  --note "This release of the app loads model data 1.1.0 (site/assessment-data.yaml), which adds a Governance category and renumbers others. The previous release used model data 1.0.0. Do not edit site/ or the model data."
