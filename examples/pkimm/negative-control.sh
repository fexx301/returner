#!/bin/sh
# DELIBERATE NEGATIVE-CONTROL TEST CASE for PKIMM 1.0.0 -> 1.1.0:
# Supplies a deliberately incomplete patch (incomplete-342.patch) that restores 3 / 4 / 2 for everybody.
# Runs through Returner's real two-profile repair loop (src/repair.mjs --attempts 1) with a stand-in
# agent that applies only that patch, demonstrating:
#   - Profile A (saved 3 / 4 / 2) PASSES replay (even after reload)
#   - Profile B (holdout, saved 5 / 1 (default) / 4) FAILS on wrong answers
#   - Returner REJECTS the patch overall (exits 1)
set -eu
cd "$(dirname "$0")/../.."
PATCH="$PWD/examples/pkimm/incomplete-342.patch"
SHIM="$(mktemp -d "${TMPDIR:-/tmp}/returner-negctrl-XXXXXX")"
trap 'rm -rf "$SHIM"' EXIT INT TERM
cat > "$SHIM/codex" <<EOF
#!/bin/sh
cat > /dev/null
git apply "$PATCH"
EOF
chmod +x "$SHIM/codex"
U=examples/pkimm/.upstream
PATH="$SHIM:$PATH" exec node src/repair.mjs --agent codex --attempts 1 \
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
  --note "DELIBERATE TEST CASE: incomplete 3 / 4 / 2 patch."
