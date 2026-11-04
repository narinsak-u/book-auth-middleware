#!/usr/bin/env bash
set -euo pipefail

root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
project="central-identity-smoke-$$"
reading_volume="${project}-reading-db"
reading_repo=${READING_REPO_PATH:-"$root/../implement-25-reading"}
export COMPOSE_PROJECT_NAME="$project"
export READING_REPO_PATH="$reading_repo"
export READING_DB_VOLUME="$reading_volume"
export AUTH_DOMAIN=identity.localhost
export BETTER_AUTH_URL=https://identity.localhost
export BETTER_AUTH_SECRET=synthetic-provider-auth-secret-at-least-32-characters
export POSTGRES_PASSWORD=synthetic-provider-db-password
export DATABASE_URL=postgres://central:synthetic-provider-db-password@db:5432/central
export SMTP_HOST=127.0.0.1 SMTP_PORT=2525
export SMTP_FROM='Synthetic Identity <identity@example.invalid>'
export SMTP_USER=synthetic SMTP_PASSWORD=synthetic
export READING_DOMAIN=reading.localhost
export READING_POSTGRES_DB=reading
export READING_POSTGRES_USER=reading
export READING_POSTGRES_PASSWORD=synthetic-reading-db-password
export READING_DATABASE_URL=postgres://reading:synthetic-reading-db-password@reading-db:5432/reading
export READING_AUTH_SECRET=synthetic-reading-auth-secret-at-least-32-characters
export READING_STRIPE_SECRET_KEY=sk_live_synthetic_nonproduction
export READING_STRIPE_WEBHOOK_SECRET=whsec_synthetic_nonproduction
export READING_OIDC_CLIENT_ID=synthetic-reading-client
export READING_OIDC_CLIENT_SECRET=synthetic-reading-client-secret
export READING_OIDC_REDIRECT_URI=https://reading.localhost/api/auth/callback/central-identity

compose=(docker compose --project-name "$project" --env-file /dev/null -f "$root/compose.production.yaml")
for required in AUTH_DOMAIN BETTER_AUTH_SECRET DATABASE_URL SMTP_HOST READING_DOMAIN READING_DB_VOLUME READING_DATABASE_URL READING_AUTH_SECRET READING_OIDC_CLIENT_SECRET; do
  if env "${required}=" "${compose[@]}" config --quiet >/dev/null 2>&1; then
    echo "Compose accepted missing ${required}" >&2
    exit 1
  fi
done


docker volume create "$reading_volume" >/dev/null
"${compose[@]}" up --detach --build --wait

curl --fail --silent --show-error --insecure --resolve identity.localhost:443:127.0.0.1 \
  https://identity.localhost/health/ready >/dev/null
curl --fail --silent --show-error --insecure --resolve reading.localhost:443:127.0.0.1 \
  https://reading.localhost/ >/dev/null
curl --fail --silent --show-error --insecure --resolve reading.localhost:443:127.0.0.1 \
  https://reading.localhost/api/auth/get-session >/dev/null

issuer=$(curl --fail --silent --show-error --insecure --resolve identity.localhost:443:127.0.0.1 \
  https://identity.localhost/.well-known/openid-configuration)
ISSUER_JSON="$issuer" node -e 'if (JSON.parse(process.env.ISSUER_JSON).issuer !== "https://identity.localhost") process.exit(1)'

callback=$(curl --fail --silent --show-error --insecure --resolve reading.localhost:443:127.0.0.1 \
  -H 'content-type: application/json' -d '{"provider":"central-identity","callbackURL":"https://reading.localhost/"}' \
  https://reading.localhost/api/auth/sign-in/social)
printf '%s' "$callback" | node -e 'let body="";process.stdin.on("data",chunk=>body+=chunk);process.stdin.on("end",()=>{const url=new URL(JSON.parse(body).url);if(url.searchParams.get("redirect_uri")!=="https://reading.localhost/api/auth/callback/central-identity")process.exit(1)})'

echo 'Synthetic production Compose smoke passed; no operator domain, credentials, or database volume was used.'
