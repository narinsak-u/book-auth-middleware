#!/usr/bin/env bash
set -euo pipefail

while IFS= read -r -d '' file; do
  case "$file" in
    .env.keys*|*/.env.keys*)
      echo "Refusing to commit dotenvx private keys: $file" >&2
      exit 1
      ;;
    .env.development|.env.production)
      if ! git diff --quiet -- "$file"; then
        echo "Refusing partially staged environment file: $file" >&2
        exit 1
      fi
      if [ ! -s .env.keys ]; then
        echo "Cannot commit $file: .env.keys is missing or empty; restore your backed-up key first." >&2
        exit 1
      fi
      bun run env:encrypt -- -f "$file"
      git add -- "$file"
      if ! git show ":$file" | awk -F= '
        /^[[:space:]]*(#|$)/ { next }
        {
          value = substr($0, index($0, "=") + 1)
          if ($1 ~ /^DOTENV_PUBLIC_KEY(_[A-Z]+)?$/ && value ~ /^"[0-9a-f]+"$/) next
          if (value ~ /^"?encrypted:[A-Za-z0-9+\/=]+"?$/) next
          exit 1
        }
      '; then
        echo "Refusing plaintext values in staged environment file: $file" >&2
        exit 1
      fi
      ;;
    .env.example|.env.development.example|.env.production.example) ;;
    .env|.env.*|*/.env|*/.env.*)
      echo "Refusing to commit an unsupported environment file: $file" >&2
      exit 1
      ;;
  esac
done < <(git diff --cached --name-only -z --diff-filter=ACMR)
