#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
DEFAULT_ROOT="$(cd -- "$SCRIPT_DIR/../../../.." && pwd)"
ROOT="${1:-$DEFAULT_ROOT}"

if [[ ! -f "$ROOT/package.json" || ! -f "$ROOT/src/core/level-model.ts" ]]; then
  printf 'Catscapades repository not found at %s\n' "$ROOT" >&2
  exit 2
fi

cd "$ROOT"
printf '== Catscapades event trace ==\n'
npm run playtest
printf '\n== Level-model regression tests ==\n'
npx vitest run src/core/level-model.test.ts
printf '\n== Strict TypeScript ==\n'
npm run typecheck
printf '\nAgentic playtest validation passed.\n'
