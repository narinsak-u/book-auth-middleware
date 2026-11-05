#!/usr/bin/env bash
set -euo pipefail

root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
project="central-identity-smoke-$(date +%s)-$$-${RANDOM}"
reading_volume="${project}-reading-db"
reading_repo=${READING_REPO_PATH:-"$root/../read-in-peace"}
tmpdir=$(mktemp -d)
reading_volume_created=0
compose=()

cleanup() {
  if ((${#compose[@]})); then
    "${compose[@]}" down --volumes --remove-orphans >/dev/null 2>&1 || true
  fi
  if ((reading_volume_created)); then
    docker volume rm "$reading_volume" >/dev/null 2>&1 || true
  fi
  rm -rf "$tmpdir"
}
trap cleanup EXIT

if [[ ! -f "$reading_repo/backend/Dockerfile" || ! -f "$reading_repo/frontend/Dockerfile" ]]; then
  echo "Set READING_REPO_PATH to the Read in Peace checkout." >&2
  exit 1
fi
if docker volume inspect "$reading_volume" >/dev/null 2>&1; then
  echo "Refusing to reuse an existing Reading volume." >&2
  exit 1
fi

https_port=$(node -e 'const net=require("node:net");const server=net.createServer();server.listen(0,"127.0.0.1",()=>{process.stdout.write(String(server.address().port));server.close()})')
identity_host=identity.localhost
reading_host=reading.localhost
export COMPOSE_PROJECT_NAME="$project"
export READING_REPO_PATH="$reading_repo"
export READING_DB_VOLUME="$reading_volume"
export AUTH_DOMAIN="${identity_host}:${https_port}"
export BETTER_AUTH_URL="https://${AUTH_DOMAIN}"
export BETTER_AUTH_SECRET=synthetic-provider-auth-secret-at-least-32-characters
export POSTGRES_PASSWORD=synthetic-provider-db-password
export DATABASE_URL=postgres://central:synthetic-provider-db-password@db:5432/central
export SMTP_HOST=smtp.invalid SMTP_PORT=587
export SMTP_FROM='Synthetic Identity <identity@example.invalid>'
export SMTP_USER=synthetic SMTP_PASSWORD=synthetic
export READING_DOMAIN="${reading_host}:${https_port}"
export READING_POSTGRES_DB=reading
export READING_POSTGRES_USER=reading
export READING_POSTGRES_PASSWORD=synthetic-reading-db-password
export READING_DATABASE_URL=postgres://reading:synthetic-reading-db-password@reading-db:5432/reading
export READING_AUTH_SECRET=synthetic-reading-auth-secret-at-least-32-characters
export READING_STRIPE_SECRET_KEY=synthetic-stripe-secret
export READING_STRIPE_WEBHOOK_SECRET=synthetic-webhook-secret
export READING_OIDC_CLIENT_ID=synthetic-reading-client
export READING_OIDC_CLIENT_SECRET=synthetic-reading-client-secret
export READING_OIDC_REDIRECT_URI="https://${READING_DOMAIN}/api/auth/callback/central-identity"

override="$tmpdir/compose.override.yaml"
cat >"$override" <<EOF
services:
  caddy:
    ports: !override
      - "127.0.0.1:${https_port}:${https_port}"
networks:
  production:
    name: "${project}-production"
EOF
compose=(docker compose --project-name "$project" --env-file /dev/null -f "$root/compose.production.yaml" -f "$override")

for required in AUTH_DOMAIN BETTER_AUTH_URL BETTER_AUTH_SECRET POSTGRES_PASSWORD DATABASE_URL SMTP_HOST SMTP_PORT SMTP_FROM SMTP_USER SMTP_PASSWORD READING_DOMAIN READING_DB_VOLUME READING_DATABASE_URL READING_AUTH_SECRET READING_STRIPE_SECRET_KEY READING_STRIPE_WEBHOOK_SECRET READING_OIDC_CLIENT_ID READING_OIDC_CLIENT_SECRET READING_OIDC_REDIRECT_URI; do
  if env "${required}=" "${compose[@]}" config --quiet >/dev/null 2>&1; then
    echo "Compose accepted missing ${required}" >&2
    exit 1
  fi
done

docker volume create "$reading_volume" >/dev/null
reading_volume_created=1
for service in auth web reading-backend reading-frontend; do
  "${compose[@]}" build "$service"
done
"${compose[@]}" up --detach db reading-db
"${compose[@]}" run --rm --no-deps reading-backend npm exec -- drizzle-kit migrate
"${compose[@]}" up --detach --wait

curl --fail --silent --show-error --insecure --resolve "${identity_host}:${https_port}:127.0.0.1" \
  "https://${AUTH_DOMAIN}/health/ready" >/dev/null
curl --fail --silent --show-error --insecure --resolve "${identity_host}:${https_port}:127.0.0.1" \
  "https://${AUTH_DOMAIN}/api/auth/.well-known/openid-configuration" >"$tmpdir/issuer.json"
EXPECTED_ISSUER="${BETTER_AUTH_URL}/api/auth" node -e 'const issuer=JSON.parse(require("node:fs").readFileSync(process.argv[1],"utf8")).issuer;if(issuer!==process.env.EXPECTED_ISSUER)process.exit(1)' "$tmpdir/issuer.json"
curl --fail --silent --show-error --insecure --resolve "${reading_host}:${https_port}:127.0.0.1" \
  "https://${READING_DOMAIN}/" >/dev/null
curl --fail --silent --show-error --insecure --resolve "${reading_host}:${https_port}:127.0.0.1" \
  "https://${READING_DOMAIN}/api/auth/get-session" >/dev/null

"${compose[@]}" config --format json | EXPECTED_ISSUER="${BETTER_AUTH_URL}/api/auth" EXPECTED_CALLBACK="$READING_OIDC_REDIRECT_URI" node -e '
  let input = "";
  process.stdin.on("data", chunk => input += chunk);
  process.stdin.on("end", () => {
    const config = JSON.parse(input);
    const services = config.services;
    const readingVolume = services["reading-db"].volumes.find(volume => volume.target === "/var/lib/postgresql/data");
    const providerVolume = services.db.volumes.find(volume => volume.target === "/var/lib/postgresql/data");
    const frontend = services["reading-frontend"].environment;
    const valid =
      services["reading-backend"].environment.CENTRAL_IDENTITY_ISSUER === process.env.EXPECTED_ISSUER &&
      services.auth.environment.READING_OIDC_REDIRECT_URI === process.env.EXPECTED_CALLBACK &&
      services.auth.environment.READING_OIDC_CLIENT_ID === services["reading-backend"].environment.CENTRAL_IDENTITY_CLIENT_ID &&
      readingVolume?.source === process.env.READING_DB_VOLUME &&
      readingVolume?.source !== providerVolume?.source &&
      services.db.environment.POSTGRES_PASSWORD !== services["reading-db"].environment.POSTGRES_PASSWORD &&
      !Object.hasOwn(services, "mailpit") &&
      Object.values(services).filter(service => service.ports?.length).length === 1 &&
      !["DATABASE_URL", "AUTH_SECRET", "STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "CENTRAL_IDENTITY_CLIENT_SECRET"].some(key => Object.hasOwn(frontend, key));
    if (!valid) process.exit(1);
  });
'

echo 'Synthetic production Compose smoke passed; only synthetic settings and a disposable database volume were used.'
