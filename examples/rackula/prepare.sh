#!/bin/sh
# Fetches and builds the Rackula commits behind RackulaLives/Rackula#935 (MIT). Nothing upstream is vendored;
# everything lands in examples/rackula/.upstream (gitignored). The regression was caught by the maintainers during
# v0.7.0 release prep and fixed before v0.7.0 was tagged, so the "broken" candidate is the commit before the fix.
#   v1               v0.6.16, built (autosaves a single `rack` to localStorage)
#   candidate-source the commit before the fix (expects a `racks` array; a returning user's saved rack is lost)
#   fixed            the maintainers' fix (#940), for comparison
set -eu
cd "$(dirname "$0")"
U=.upstream
OLD=2dc4795bfd18ba0b457608add2c2498ab8a8da8e          # tag v0.6.16
BROKEN=223ac90eb08c094b52f0dc1f1b63749f8c47b775
FIXED=9fe6e2efc3c76fa75e5d6d6366213354116217eb
rm -rf "$U" && mkdir -p "$U"
git clone -q --filter=blob:none https://github.com/RackulaLives/Rackula.git "$U/repo"
build() { git -C "$U/repo" worktree add -q "../$1" "$2" && (cd "$U/$1" && rm -f .git && npm ci --ignore-scripts --no-audit --no-fund --loglevel=error && npx vite build --logLevel error); }
build old "$OLD" && cp -R "$U/old/dist" "$U/v1"
build candidate-source "$BROKEN"
build fixed "$FIXED"
echo "Prepared $U"
