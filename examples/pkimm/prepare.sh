#!/bin/sh
# Fetches the exact upstream revisions behind pkic/self-assessment issue #148 (MIT code and data, PKI Consortium).
# Nothing upstream is vendored in this repo; everything lands in examples/pkimm/.upstream (gitignored).
#   v1               widget v1.0.3 built from source + PKIMM model data 1.0.0  (the release users saved work on)
#   candidate-source widget v1.0.3 source + model data 1.1.0 in site/        (the release that broke returning users)
#   v2.0.0           the maintainers' published fix, for comparison
set -eu
cd "$(dirname "$0")"
U=.upstream
rm -rf "$U" && mkdir -p "$U"
WIDGET=a13f03bf3de5c534e27550dff68cb7f6dc803a37   # tag v1.0.3
DATA=060be60bf6ad16a0d6fcb967ef6d06e29771bf3f     # pkic/pkimm on 2026-05-14, the day #148 was filed
git clone -q --branch v1.0.3 --depth 1 https://github.com/pkic/self-assessment.git "$U/candidate-source"
test "$(git -C "$U/candidate-source" rev-parse HEAD)" = "$WIDGET"
rm -rf "$U/candidate-source/.git"
for f in config.yaml data-1.0.0.yaml data-1.1.0.yaml; do
  curl -fsSL "https://raw.githubusercontent.com/pkic/pkimm/$DATA/tools/self-assessment/$f" -o "$U/$f"
done
shasum -a 256 -c <<SUMS
b0f80e94c604d859b8d9f0f2fc2b9711e40635af1f404ffc0c97f6c76981971d  $U/config.yaml
d172e9e0e90e5ecd4210a96a78f40a8556d587aa75c611e4fab1a1f5d889f680  $U/data-1.0.0.yaml
7bffe06b701749eae0430e8ace73bd3d068c1503b7575fcff26e775cd8ecee6e  $U/data-1.1.0.yaml
SUMS
page='<!doctype html><html lang="en"><head><meta charset="UTF-8"><title>PKIMM self-assessment</title></head><body><self-assessment dataUrl="assessment-data.yaml" configUrl="config.yaml"></self-assessment><script src="self-assessment.js"></script></body></html>'
S="$U/candidate-source/site"
mkdir -p "$S" && printf '%s\n' "$page" > "$S/index.html"
cp "$U/config.yaml" "$S/config.yaml" && cp "$U/data-1.1.0.yaml" "$S/assessment-data.yaml"
printf '\n/site/self-assessment.js\n' >> "$U/candidate-source/.gitignore"
(cd "$U/candidate-source" && npm ci --no-audit --no-fund --loglevel=error && npm run build --silent)
mkdir -p "$U/v1" && printf '%s\n' "$page" > "$U/v1/index.html"
cp "$U/config.yaml" "$U/v1/config.yaml" && cp "$U/data-1.0.0.yaml" "$U/v1/assessment-data.yaml"
cp "$U/candidate-source/dist/self-assessment.js" "$U/v1/"
mkdir -p "$U/v2.0.0"
for f in index.html self-assessment.js pkimm-model-1.0.0.yaml pkimm-model-2.0.0.yaml pkimm-references.yaml; do
  curl -fsSL "https://pkic.github.io/self-assessment/v2.0.0/$f" -o "$U/v2.0.0/$f"
done
echo "Prepared $U"
