#!/usr/bin/env bash
set -euo pipefail

case "${1:-}" in
  encrypt|decrypt) action="$1" ;;
  *) echo "Usage: scripts/env-all.sh encrypt|decrypt" >&2; exit 2 ;;
esac

files=(.env.development .env.production .env.test-production)
keys=(.env.keys .env.keys .env.test-production.keys)

for path in "${files[@]}" "${keys[@]}"; do
  if [ ! -s "$path" ]; then
    echo "Cannot $action all environments: $path is missing or empty." >&2
    exit 1
  fi
done

for index in "${!files[@]}"; do
  dotenvx "$action" -f "${files[$index]}" -fk "${keys[$index]}"
done
