#!/usr/bin/env bash
# Full review pass for one model: headless report, per-clip motion analysis,
# and screenshots from every angle. Prints where the images landed so they can
# be read — capturing without looking is not a review.
set -euo pipefail

ROOT="${2:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)}"
MODEL="${1:-}"
cd "$ROOT"

if [ -z "$MODEL" ]; then
  echo "usage: review-model.sh <model-id> [repo-root]" >&2
  echo >&2
  npm run --silent models
  exit 1
fi

echo "== headless report =================================================="
npm run --silent models -- "$MODEL" --clips || true

echo
echo "== screenshots ======================================================"
npm run --silent models:capture -- "$MODEL" --clips

echo
echo "Read the PNGs in .model-captures/ before reporting on appearance."
