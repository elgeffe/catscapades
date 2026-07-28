#!/usr/bin/env bash
# Gate for model work: audits every registered model and fails on any warning,
# then captures a hero shot of each for a visual sweep.
set -euo pipefail

ROOT="${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)}"
cd "$ROOT"

echo "== auditing every registered model =================================="
npm run --silent models -- --all
status=$?

echo
echo "== hero shots ======================================================="
npm run --silent models:capture -- --clean

exit $status
