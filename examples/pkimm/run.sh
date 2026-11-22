#!/bin/sh
# Rehearses the PKIMM 1.0.0 -> 1.1.0 release with Kane using two distinct returning-user profiles:
#   Profile A: Strategy and Vision = 3 - Advanced, Infrastructure management = 4 - Managed, Sourcing = 2 - Basic
#   Profile B (holdout, outside the agent workspace): Strategy and Vision = 5 - Optimized,
#              Infrastructure management = 1 - Initial (app default, left untouched), Sourcing = 4 - Managed
# A repair passes only if both returning users keep their own answers after a reload, see Cryptography,
# and pass a fresh rehearsal with a new marker. Usage: examples/pkimm/run.sh [codex|claude]
set -eu
cd "$(dirname "$0")/../.."
U=examples/pkimm/.upstream
exec node src/repair.mjs --agent "${1:-codex}" --attempts 3 \
  --old "$U/v1" --source "$U/candidate-source" --serve site \
  --build 'test -d node_modules || npm ci --no-audit --no-fund --loglevel=error; npm run build --silent && cp dist/self-assessment.js site/' \
  --promise "My saved assessment survives the model update, and I see the new model" \
  --seed 'Open the Report tab. Type "{title}" into the Assessment Name field and "{body}" into the Assessor Name field. Open the Governance tab and select level "3 - Advanced" for "Strategy and Vision". Open the Management tab and select level "4 - Managed" for "Infrastructure management". Open the Resources tab and select level "2 - Basic" for "Sourcing". Reload the page. On the Report tab, verify Assessment Name is exactly "{title}" and Assessor Name is exactly "{body}". Open the Governance tab and verify "Strategy and Vision" is at level "3 - Advanced". Open the Management tab and verify "Infrastructure management" is at level "4 - Managed". Open the Resources tab and verify "Sourcing" is at level "2 - Basic".' \
  --check 'Reload the page. On the Report tab, verify the Assessment Name is exactly "{title}" and the Assessor Name is exactly "{body}". Open the Governance tab: verify "Strategy and Vision" is at level "3 - Advanced" and a category named "Cryptography" is listed. Open the Management tab: verify "Infrastructure management" is at level "4 - Managed". Open the Resources tab: verify "Sourcing" is at level "2 - Basic". This is a read-only check: do not type, select or change anything.' \
  --holdout-seed 'Open the Report tab. Type "{title}" into the Assessment Name field and "{body}" into the Assessor Name field. Open the Governance tab and select level "5 - Optimized" for "Strategy and Vision". Open the Management tab and confirm "Infrastructure management" is already at its default level "1 - Initial" without changing it. Open the Resources tab and select level "4 - Managed" for "Sourcing". Reload the page. On the Report tab, verify Assessment Name is exactly "{title}" and Assessor Name is exactly "{body}". Open the Governance tab and verify "Strategy and Vision" is at level "5 - Optimized". Open the Management tab and verify "Infrastructure management" is at level "1 - Initial". Open the Resources tab and verify "Sourcing" is at level "4 - Managed".' \
  --holdout-check 'Reload the page. On the Report tab, verify the Assessment Name is exactly "{title}" and the Assessor Name is exactly "{body}". Open the Governance tab: verify "Strategy and Vision" is at level "5 - Optimized" and a category named "Cryptography" is listed. Open the Management tab: verify "Infrastructure management" is at level "1 - Initial". Open the Resources tab: verify "Sourcing" is at level "4 - Managed". This is a read-only check: do not type, select or change anything.' \
  --holdout-secret "5 - Optimized" --holdout-secret "1 - Initial" --holdout-secret "4 - Managed" \
  --holdout-field "Assessment Name" --holdout-field "Assessor Name" \
  --holdout-field "Strategy and Vision" --holdout-field "Infrastructure management" \
  --holdout-field "Sourcing" --holdout-field "Cryptography" \
  --reference "$U/data-1.0.0.yaml" \
  --note "This release of the app loads model data 1.1.0 (site/assessment-data.yaml), which adds a Governance category and renumbers others. The previous release used model data 1.0.0. Migrate each user's actual saved answers rather than hard-coding any fixed levels. Do not edit site/ or the model data."
