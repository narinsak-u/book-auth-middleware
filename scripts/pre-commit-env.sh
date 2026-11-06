#!/usr/bin/env bash
set -euo pipefail

while IFS= read -r -d '' file; do
  case "$file" in
    .env.keys*|.env.test-production.keys*|*/.env.keys*|*/.env.test-production.keys*)
      echo "Refusing to commit dotenvx private keys: $file" >&2
      exit 1
      ;;
    .env.development|.env.production|.env.test-production)
      if ! git diff --quiet -- "$file"; then
        echo "Refusing partially staged environment file: $file" >&2
        exit 1
      fi
      if [ "$file" = .env.test-production ]; then
        key_file=.env.test-production.keys
        encrypt_script=env:encrypt:test-production
      else
        key_file=.env.keys
        if [ "$file" = .env.production ]; then
          encrypt_script=env:encrypt:production
        else
          encrypt_script=env:encrypt:development
        fi
      fi
      if [ ! -s "$key_file" ]; then
        echo "Cannot commit $file: $key_file is missing or empty; restore your backed-up key first." >&2
        exit 1
      fi
      bun run "$encrypt_script"
      git add -- "$file"
      if ! git show ":$file" | awk -F= '
        /^[[:space:]]*(#|$)/ { next }
        {
          value = substr($0, index($0, "=") + 1)
          if ($1 ~ /^DOTENV_PUBLIC_KEY(_[A-Z_-]+)?$/ && value ~ /^"[0-9a-f]+"([[:space:]]+#.*)?$/) next
          if (value ~ /^"?encrypted:[A-Za-z0-9+\/=]+"?$/) next
          exit 1
        }
      '; then
        echo "Refusing plaintext values in staged environment file: $file" >&2
        exit 1
      fi
      ;;
    .env.example|.env.development.example|.env.identity.production.example|.env.test-production.example) ;;
    .env|.env.*|*/.env|*/.env.*)
      echo "Refusing to commit an unsupported environment file: $file" >&2
      exit 1
      ;;
  esac
done < <(git diff --cached --name-only -z --diff-filter=ACMR)
