#!/usr/bin/env bash
set -euo pipefail

root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
project="central-identity-smoke-$(date +%s)-$$-${RANDOM}"
volume="${project}-production-db"
tmpdir=$(mktemp -d)
volume_created=0
compose=()
ingress="${project}-ingress"

cleanup() {
  if ((${#compose[@]})); then
    "${compose[@]}" down --remove-orphans >/dev/null 2>&1 || true
  fi
  if ((volume_created)); then docker volume rm "$volume" >/dev/null 2>&1 || true; fi
  docker rm --force "$ingress" >/dev/null 2>&1 || true
  rm -rf "$tmpdir"
}
trap cleanup EXIT

free_port() {
  node -e 'const net=require("node:net");const server=net.createServer();server.listen(0,"127.0.0.1",()=>{process.stdout.write(String(server.address().port));server.close()})'
}

auth_port=$(free_port)
portal_port=$(free_port)
https_port=$(free_port)
identity_host=identity.localhost
export COMPOSE_PROJECT_NAME="$project"
export IDENTITY_AUTH_PORT="$auth_port" IDENTITY_PORT="$portal_port"
export AUTH_DOMAIN="${identity_host}:${https_port}"
export BETTER_AUTH_URL="https://${AUTH_DOMAIN}"
export BETTER_AUTH_SECRET=synthetic-provider-auth-secret-at-least-32-characters
export POSTGRES_PASSWORD=synthetic-provider-db-password
export DATABASE_URL=postgres://central:synthetic-provider-db-password@db:5432/central
export SMTP_HOST=smtp.invalid SMTP_PORT=587
export SMTP_FROM='Synthetic Identity <identity@example.invalid>'
export SMTP_USER=synthetic SMTP_PASSWORD=synthetic
export IDENTITY_DB_VOLUME="$volume"
if docker volume inspect "$volume" >/dev/null 2>&1; then
  echo "Refusing to reuse existing provider volume: $volume" >&2
  exit 1
fi
docker volume create "$volume" >/dev/null
volume_created=1
compose=(docker compose --project-name "$project" --env-file /dev/null -f "$root/compose.identity.production.yaml")

"${compose[@]}" up --build --detach --wait
cat >"$tmpdir/Caddyfile" <<EOF
https://${identity_host} {
  @identity path /api/auth/* /.well-known/* /oauth2/* /health/*
  handle @identity {
    reverse_proxy host.docker.internal:${auth_port}
  }
  handle {
    reverse_proxy host.docker.internal:${portal_port}
  }
  tls internal
}
EOF
docker run --detach --name "$ingress" --add-host host.docker.internal:host-gateway \
  --publish "127.0.0.1:${https_port}:443" \
  --volume "$tmpdir/Caddyfile:/etc/caddy/Caddyfile:ro" \
  caddy:2.10.0-alpine >/dev/null

for attempt in {1..30}; do
  if curl --fail --silent --insecure --resolve "${identity_host}:${https_port}:127.0.0.1" \
    "https://${AUTH_DOMAIN}/health/ready" >/dev/null; then
    break
  fi
  sleep 1
done
curl --fail --silent --show-error --insecure --resolve "${identity_host}:${https_port}:127.0.0.1" \
  "https://${AUTH_DOMAIN}/health/ready" >/dev/null
curl --fail --silent --show-error --insecure --resolve "${identity_host}:${https_port}:127.0.0.1" \
  "https://${AUTH_DOMAIN}/api/auth/.well-known/openid-configuration" >"$tmpdir/issuer.json"
EXPECTED_ISSUER="${BETTER_AUTH_URL}/api/auth" node -e 'const issuer=JSON.parse(require("node:fs").readFileSync(process.argv[1],"utf8")).issuer;if(issuer!==process.env.EXPECTED_ISSUER)process.exit(1)' "$tmpdir/issuer.json"
curl --fail --silent --show-error --insecure --resolve "${identity_host}:${https_port}:127.0.0.1" \
  "https://${AUTH_DOMAIN}/sign-in" >/dev/null

echo 'Synthetic standalone identity HTTPS smoke passed.'
