#!/usr/bin/env bash
set -euo pipefail

root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
reading_repo=${READING_REPO_PATH:?Set READING_REPO_PATH to the independent Reading checkout}
edge_repo=${EDGE_REPO_PATH:?Set EDGE_REPO_PATH to the neutral edge checkout}
bidding_repo=${BIDDING_REPO_PATH:?Set BIDDING_REPO_PATH to the Bidding checkout}
legacy_repo=${LEGACY_PROVIDER_CHECKOUT:?Set LEGACY_PROVIDER_CHECKOUT to the retained legacy provider release checkout}
source_provider_db=${SOURCE_PROVIDER_DB_CONTAINER:?Set SOURCE_PROVIDER_DB_CONTAINER to a synthetic provider PostgreSQL container}
source_reading_db=${SOURCE_READING_DB_CONTAINER:?Set SOURCE_READING_DB_CONTAINER to a synthetic Reading PostgreSQL container}
edge_container=${CUTOVER_EDGE_CONTAINER:?Set CUTOVER_EDGE_CONTAINER to the disposable synthetic edge container name}
test_user_file=${CENTRAL_IDENTITY_TEST_USER_FILE:?Set CENTRAL_IDENTITY_TEST_USER_FILE to a mode-0600 JSON file with email and password}
ca_data=${REHEARSAL_CA_DATA_DIR:?Set REHEARSAL_CA_DATA_DIR to trusted synthetic Caddy data directory}
ca_cert=${REHEARSAL_CA_CERT:?Set REHEARSAL_CA_CERT to trusted synthetic Caddy root certificate}
https_port=${CUTOVER_HTTPS_PORT:?Set CUTOVER_HTTPS_PORT; use the existing synthetic identity port}
ack=${CUTOVER_ACK_STOP_EDGE:-}
identity_host=${CUTOVER_IDENTITY_HOST:-identity.localtest.me}
reading_host=${CUTOVER_READING_HOST:-reading.localtest.me}
bidding_host=${CUTOVER_BIDDING_HOST:-bidding.localtest.me}
bidding_upstream=${CUTOVER_BIDDING_UPSTREAM:?Set CUTOVER_BIDDING_UPSTREAM to the reachable host:port for synthetic Bidding}
provider_auth_secret=${CUTOVER_PROVIDER_AUTH_SECRET:?Set CUTOVER_PROVIDER_AUTH_SECRET from protected synthetic provider settings}
reading_auth_secret=${CUTOVER_READING_AUTH_SECRET:?Set CUTOVER_READING_AUTH_SECRET from protected synthetic Reading settings}

[[ $https_port == 15443 ]] || { echo 'Synthetic browser callbacks require CUTOVER_HTTPS_PORT=15443.' >&2; exit 1; }
[[ $ack == "$edge_container:$https_port" ]] || { echo 'Set CUTOVER_ACK_STOP_EDGE to exactly <edge-container>:<https-port> after coordinating the synthetic ingress handoff.' >&2; exit 1; }
[[ -f $test_user_file && -r $test_user_file && -f $ca_cert && -r $ca_cert && -d $ca_data && -d $reading_repo && -d $edge_repo && -d $bidding_repo && -f "$legacy_repo/compose.production.yaml" ]] || { echo 'A required checkout, test-user file, CA file, or CA data directory is unavailable.' >&2; exit 1; }
[[ $(stat -c '%a' "$test_user_file") == 600 ]] || { echo 'Test-user JSON must have mode 0600.' >&2; exit 1; }
node -e 'const u=JSON.parse(require("node:fs").readFileSync(process.argv[1]));if(typeof u.email!=="string"||!u.email||typeof u.password!=="string"||!u.password)process.exit(1)' "$test_user_file" || { echo 'Test-user JSON must contain non-empty email and password fields.' >&2; exit 1; }
[[ $bidding_upstream =~ ^[A-Za-z0-9.-]+:[0-9]{1,5}$ ]] && bidding_port=${bidding_upstream##*:} && ((10#$bidding_port >= 1 && 10#$bidding_port <= 65535)) || { echo 'CUTOVER_BIDDING_UPSTREAM must be a valid host:port.' >&2; exit 1; }
command -v docker >/dev/null && command -v curl >/dev/null && command -v bun >/dev/null && command -v node >/dev/null || { echo 'Docker, curl, Bun, and Node are required.' >&2; exit 1; }
docker info >/dev/null
for source_db in "$source_provider_db" "$source_reading_db"; do
  [[ $(docker inspect --format '{{.Config.Image}}' "$source_db") == postgres:17.5-alpine ]] || { echo "$source_db must be a synthetic PostgreSQL 17.5 container." >&2; exit 1; }
  source_project=$(docker inspect --format '{{ index .Config.Labels "com.docker.compose.project" }}' "$source_db")
  [[ $source_project =~ (^|[-_])(proof|synthetic)([-_]|$) ]] || { echo "Refusing database source outside a named synthetic Compose project: $source_db" >&2; exit 1; }
done
[[ $(docker inspect --format '{{.State.Running}}' "$edge_container") == true ]] || { echo 'The named synthetic edge must be running before rehearsal.' >&2; exit 1; }
docker inspect --format '{{json .NetworkSettings.Ports}}' "$edge_container" | node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{const p=JSON.parse(s),ports=Object.entries(p).flatMap(([container,bindings])=>(bindings??[]).map(binding=>[container,binding]));if(ports.length!==1||ports[0][0]!=="443/tcp"||ports[0][1].HostPort!=="15443"||ports[0][1].HostIp!=="127.0.0.1")process.exit(1)})' || { echo 'Named synthetic edge must own only loopback port 15443, with no public 80/443 listener, for the coordinated handoff.' >&2; exit 1; }
[[ $(docker inspect --format '{{.HostConfig.AutoRemove}}' "$edge_container") == false ]] || { echo 'Refusing to stop an auto-removed edge; rollback requires a persistent container.' >&2; exit 1; }

project="cutover-49-$(date +%s)-$$-${RANDOM}"
provider_volume="${project}-identity"
reading_volume="${project}-reading"
provider_restore_volume="${project}-identity-restore"
reading_restore_volume="${project}-reading-restore"
provider_old="${project}-identity-old-owner"
reading_old="${project}-reading-old-owner"
provider_project="${project}-identity"
reading_project="${project}-reading"
old_ingress="${project}-old-ingress"
new_ingress="${project}-new-ingress"
tmpdir=$(mktemp -d)
chmod 700 "$tmpdir"
parent_edge_stopped=0
compose_provider=() compose_reading=() compose_legacy=()

owned_volume() {
  docker volume inspect --format '{{ index .Labels "cutover.rehearsal.project" }}' "$1" 2>/dev/null
}
create_owned_volume() {
  local volume=$1
  if docker volume inspect "$volume" >/dev/null 2>&1; then echo "Refusing to reuse existing disposable volume: $volume" >&2; return 1; fi
  docker volume create --label "cutover.rehearsal.project=$project" "$volume" >/dev/null
  [[ $(owned_volume "$volume") == "$project" ]] || { echo "Could not establish ownership of disposable volume: $volume" >&2; return 1; }
}
cleanup() {
  local exit_status=$?
  set +e
  docker rm -f "$old_ingress" "$new_ingress" "$provider_old" "$reading_old" "${project}-identity-restore" "${project}-reading-restore" >/dev/null 2>&1
  if ((parent_edge_stopped)) && ! docker start "$edge_container" >/dev/null 2>&1; then
    echo "FATAL: could not restore edge container $edge_container on port $https_port." >&2
    exit_status=1
  fi
  if ((${#compose_provider[@]})); then "${compose_provider[@]}" down --remove-orphans >/dev/null 2>&1; fi
  if ((${#compose_reading[@]})); then "${compose_reading[@]}" down --remove-orphans >/dev/null 2>&1; fi
  if ((${#compose_legacy[@]})); then "${compose_legacy[@]}" down --remove-orphans >/dev/null 2>&1; fi
  for volume in "$provider_volume" "$reading_volume" "$provider_restore_volume" "$reading_restore_volume"; do
    if [[ $(owned_volume "$volume") == "$project" ]]; then docker volume rm "$volume" >/dev/null 2>&1; fi
  done
  rm -rf "$tmpdir"
  return "$exit_status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

umask 077
docker exec "$source_provider_db" sh -ec 'PGPASSWORD="$POSTGRES_PASSWORD" pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom' >"$tmpdir/provider.dump"
docker exec "$source_reading_db" sh -ec 'PGPASSWORD="$POSTGRES_PASSWORD" pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom' >"$tmpdir/reading.dump"
docker run --rm -i postgres:17.5-alpine sh -c 'cat >/tmp/provider.dump && pg_restore --list /tmp/provider.dump >/dev/null' <"$tmpdir/provider.dump"
docker run --rm -i postgres:17.5-alpine sh -c 'cat >/tmp/reading.dump && pg_restore --list /tmp/reading.dump >/dev/null' <"$tmpdir/reading.dump"

create_owned_volume "$provider_volume"
create_owned_volume "$reading_volume"
create_owned_volume "$provider_restore_volume"
create_owned_volume "$reading_restore_volume"

start_pg() {
  local name=$1 volume=$2 user=$3 database=$4 password=$5
  docker run -d --name "$name" -e "POSTGRES_USER=$user" -e "POSTGRES_DB=$database" -e "POSTGRES_PASSWORD=$password" -v "$volume:/var/lib/postgresql/data" postgres:17.5-alpine >/dev/null
  for _ in {1..60}; do docker exec "$name" pg_isready -U "$user" -d "$database" >/dev/null 2>&1 && return; sleep 1; done
  echo "PostgreSQL did not become ready: $name" >&2; return 1
}
restore_dump() { docker exec -i "$1" pg_restore --no-owner --no-acl -U "$2" -d "$3" <"$4"; }

provider_password="${project}-provider-db-password"
reading_password="${project}-reading-db-password"
start_pg "$provider_old" "$provider_volume" central central "$provider_password"
start_pg "$reading_old" "$reading_volume" reading reading "$reading_password"
start_pg "${project}-identity-restore" "$provider_restore_volume" central central "$provider_password"
start_pg "${project}-reading-restore" "$reading_restore_volume" reading reading "$reading_password"
restore_dump "$provider_old" central central "$tmpdir/provider.dump"
restore_dump "$reading_old" reading reading "$tmpdir/reading.dump"
restore_dump "${project}-identity-restore" central central "$tmpdir/provider.dump"
restore_dump "${project}-reading-restore" reading reading "$tmpdir/reading.dump"

provider_user_count=$(docker exec "$provider_old" psql -U central -d central -Atc 'SELECT count(*) FROM "user"')
provider_client_count=$(docker exec "$provider_old" psql -U central -d central -Atc 'SELECT count(*) FROM oauth_client')
reading_user_count=$(docker exec "$reading_old" psql -U reading -d reading -Atc 'SELECT count(*) FROM "user"')
reading_content_count=$(docker exec "$reading_old" psql -U reading -d reading -Atc 'SELECT count(*) FROM books')
provider_user_digest=$(docker exec "$provider_old" psql -U central -d central -Atc 'SELECT md5(string_agg(id || chr(58) || email, chr(44) ORDER BY id)) FROM "user"')
provider_client_digest=$(docker exec "$provider_old" psql -U central -d central -Atc 'SELECT md5(string_agg(client_id || chr(58) || array_to_string(redirect_uris, chr(44)), chr(44) ORDER BY client_id)) FROM oauth_client')
provider_session_digest=$(docker exec "$provider_old" psql -U central -d central -Atc 'SELECT md5(string_agg(id || chr(58) || token || chr(58) || user_id || chr(58) || expires_at::text, chr(44) ORDER BY id)) FROM session')
reading_user_digest=$(docker exec "$reading_old" psql -U reading -d reading -Atc 'SELECT md5(string_agg(id || chr(58) || email, chr(44) ORDER BY id)) FROM "user"')
reading_content_digest=$(docker exec "$reading_old" psql -U reading -d reading -Atc 'SELECT md5(string_agg(id || chr(58) || title, chr(44) ORDER BY id)) FROM books')
reading_session_digest=$(docker exec "$reading_old" psql -U reading -d reading -Atc 'SELECT md5(string_agg(id || chr(58) || token || chr(58) || user_id || chr(58) || expires_at::text, chr(44) ORDER BY id)) FROM session')
provider_sessions_snapshot="$tmpdir/provider-sessions.json"
reading_sessions_snapshot="$tmpdir/reading-sessions.json"
session_snapshot() {
  docker exec "$1" psql -U "$2" -d "$3" -Atc 'SELECT COALESCE(json_agg(json_build_array(id::text, md5(token || chr(58) || user_id || chr(58) || expires_at::text)) ORDER BY id), '\''[]'\''::json)::text FROM session' >"$4"
}
session_rows_preserved() {
  local container=$1 user=$2 database=$3 snapshot=$4 current
  current=$(docker exec "$container" psql -U "$user" -d "$database" -Atc 'SELECT COALESCE(json_agg(json_build_array(id::text, md5(token || chr(58) || user_id || chr(58) || expires_at::text)) ORDER BY id), '\''[]'\''::json)::text FROM session')
  node -e 'const a=JSON.parse(require("node:fs").readFileSync(process.argv[1])),m=new Map(JSON.parse(process.argv[2]));if(a.some(([id,d])=>m.get(id)!==d))process.exit(1)' "$snapshot" "$current"
}
session_snapshot "$provider_old" central central "$provider_sessions_snapshot"
session_snapshot "$reading_old" reading reading "$reading_sessions_snapshot"
[[ $provider_user_count -gt 0 && $provider_client_count -gt 0 && $reading_user_count -gt 0 && $reading_content_count -gt 0 ]] || { echo 'Source backups must contain provider users, approved clients, Reading users, and Reading book content.' >&2; exit 1; }
for instance in "$provider_old" "${project}-identity-restore"; do
  [[ $(docker exec "$instance" psql -U central -d central -Atc 'SELECT md5(string_agg(id || chr(58) || email, chr(44) ORDER BY id)) FROM "user"') == "$provider_user_digest" ]]
  [[ $(docker exec "$instance" psql -U central -d central -Atc 'SELECT md5(string_agg(client_id || chr(58) || array_to_string(redirect_uris, chr(44)), chr(44) ORDER BY client_id)) FROM oauth_client') == "$provider_client_digest" ]]
  [[ $(docker exec "$instance" psql -U central -d central -Atc 'SELECT md5(string_agg(id || chr(58) || token || chr(58) || user_id || chr(58) || expires_at::text, chr(44) ORDER BY id)) FROM session') == "$provider_session_digest" ]]
done
for instance in "$reading_old" "${project}-reading-restore"; do
  [[ $(docker exec "$instance" psql -U reading -d reading -Atc 'SELECT md5(string_agg(id || chr(58) || email, chr(44) ORDER BY id)) FROM "user"') == "$reading_user_digest" ]]
  [[ $(docker exec "$instance" psql -U reading -d reading -Atc 'SELECT md5(string_agg(id || chr(58) || title, chr(44) ORDER BY id)) FROM books') == "$reading_content_digest" ]]
  [[ $(docker exec "$instance" psql -U reading -d reading -Atc 'SELECT md5(string_agg(id || chr(58) || token || chr(58) || user_id || chr(58) || expires_at::text, chr(44) ORDER BY id)) FROM session') == "$reading_session_digest" ]]
done

[[ $https_port == 15443 ]] || { echo 'Synthetic browser callbacks require CUTOVER_HTTPS_PORT=15443.' >&2; exit 1; }
free_port() { node -e 'const n=require("node:net");const s=n.createServer();s.listen(0,"127.0.0.1",()=>{console.log(s.address().port);s.close()})'; }
identity_auth_port=$(free_port)
identity_port=$(free_port)
reading_frontend_port=$(free_port)
reading_backend_port=$(free_port)
cat >"$tmpdir/provider.env" <<EOF
COMPOSE_PROJECT_NAME=$provider_project
IDENTITY_DB_VOLUME=$provider_volume
AUTH_DOMAIN=$identity_host:$https_port
BETTER_AUTH_URL=https://$identity_host:$https_port
BETTER_AUTH_SECRET=$provider_auth_secret
POSTGRES_PASSWORD=$provider_password
DATABASE_URL=postgres://central:$provider_password@db:5432/central
SMTP_HOST=smtp.invalid
SMTP_PORT=587
SMTP_FROM=Identity <identity@example.invalid>
SMTP_USER=synthetic
SMTP_PASSWORD=synthetic
IDENTITY_AUTH_PORT=$identity_auth_port
IDENTITY_PORT=$identity_port
EOF
cat >"$tmpdir/reading.env" <<EOF
COMPOSE_PROJECT_NAME=$reading_project
READING_DB_VOLUME=$reading_volume
READING_POSTGRES_DB=reading
READING_POSTGRES_USER=reading
READING_POSTGRES_PASSWORD=$reading_password
READING_DATABASE_URL=postgres://reading:$reading_password@db:5432/reading
READING_AUTH_SECRET=$reading_auth_secret
READING_STRIPE_SECRET_KEY=synthetic-stripe-secret
READING_STRIPE_WEBHOOK_SECRET=synthetic-webhook-secret
READING_FRONTEND_URL=https://$reading_host:$https_port
READING_BACKEND_URL=https://$reading_host:$https_port
READING_FRONTEND_PORT=$reading_frontend_port
READING_BACKEND_PORT=$reading_backend_port
CENTRAL_IDENTITY_ISSUER=https://$identity_host:$https_port/api/auth
NUXT_PUBLIC_CENTRAL_IDENTITY_URL=https://$identity_host:$https_port
CENTRAL_IDENTITY_CLIENT_ID=${CUTOVER_READING_CLIENT_ID:?Set CUTOVER_READING_CLIENT_ID from protected synthetic settings}
CENTRAL_IDENTITY_CLIENT_SECRET=${CUTOVER_READING_CLIENT_SECRET:?Set CUTOVER_READING_CLIENT_SECRET from protected synthetic settings}
EOF
legacy_project="${project}-legacy"
cat >"$tmpdir/legacy.env" <<EOF
COMPOSE_PROJECT_NAME=$legacy_project
READING_DB_VOLUME=$reading_volume
READING_REPO_PATH=$reading_repo
AUTH_DOMAIN=$identity_host:$https_port
BETTER_AUTH_URL=https://$identity_host:$https_port
BETTER_AUTH_SECRET=$provider_auth_secret
POSTGRES_PASSWORD=$provider_password
DATABASE_URL=postgres://central:$provider_password@db:5432/central
SMTP_HOST=smtp.invalid
SMTP_PORT=587
SMTP_FROM=Identity <identity@example.invalid>
SMTP_USER=synthetic
SMTP_PASSWORD=synthetic
BIDDING_OIDC_CLIENT_ID=${CUTOVER_BIDDING_CLIENT_ID:?Set CUTOVER_BIDDING_CLIENT_ID from protected synthetic settings}
BIDDING_OIDC_REDIRECT_URI=https://$bidding_host:$https_port/api/auth/callback/central-identity
BIDDING_RECOVERY_OIDC_REDIRECT_URI=https://$bidding_host:$https_port/api/identity-recovery/callback
READING_DOMAIN=$reading_host:$https_port
READING_POSTGRES_DB=reading
READING_POSTGRES_USER=reading
READING_POSTGRES_PASSWORD=$reading_password
READING_DATABASE_URL=postgres://reading:$reading_password@reading-db:5432/reading
READING_AUTH_SECRET=$reading_auth_secret
READING_STRIPE_SECRET_KEY=synthetic-stripe-secret
READING_STRIPE_WEBHOOK_SECRET=synthetic-webhook-secret
READING_OIDC_CLIENT_ID=$CUTOVER_READING_CLIENT_ID
READING_OIDC_CLIENT_SECRET=$CUTOVER_READING_CLIENT_SECRET
READING_OIDC_REDIRECT_URI=https://$reading_host:$https_port/api/auth/callback/central-identity
READING_RECOVERY_OIDC_REDIRECT_URI=https://$reading_host:$https_port/api/identity-recovery/callback
EOF
cat >"$tmpdir/legacy.override.yaml" <<EOF
services:
  auth:
    ports: ["127.0.0.1:$identity_auth_port:3000"]
  web:
    ports: ["127.0.0.1:$identity_port:3001"]
  reading-backend:
    ports: ["127.0.0.1:$reading_backend_port:4000"]
    extra_hosts: ["$identity_host:host-gateway"]
    environment:
      NODE_EXTRA_CA_CERTS: /tmp/cutover-root.crt
    volumes: ["$tmpdir/cutover-root.crt:/tmp/cutover-root.crt:ro"]
  reading-frontend:
    ports: ["127.0.0.1:$reading_frontend_port:3000"]
    extra_hosts: ["$identity_host:host-gateway"]
    environment:
      NODE_EXTRA_CA_CERTS: /tmp/cutover-root.crt
    volumes: ["$tmpdir/cutover-root.crt:/tmp/cutover-root.crt:ro"]
volumes:
  production-db:
    name: $provider_volume
    external: true
  reading-production-db:
    name: $reading_volume
    external: true
networks:
  production:
    name: $legacy_project
    ipam:
      config:
        - subnet: 10.242.49.0/24
EOF
# shortcut: disposable 10.242.49-51.0/24 networks avoid this WSL host; change them if occupied elsewhere.
cat >"$tmpdir/provider.override.yaml" <<EOF
networks:
  identity:
    ipam:
      config:
        - subnet: 10.242.50.0/24
EOF
cat >"$tmpdir/reading.override.yaml" <<EOF
services:
  backend:
    extra_hosts: ["$identity_host:host-gateway"]
    environment:
      NODE_EXTRA_CA_CERTS: /tmp/cutover-root.crt
    volumes: ["$tmpdir/cutover-root.crt:/tmp/cutover-root.crt:ro"]
  frontend:
    extra_hosts: ["$identity_host:host-gateway"]
    environment:
      NODE_EXTRA_CA_CERTS: /tmp/cutover-root.crt
    volumes: ["$tmpdir/cutover-root.crt:/tmp/cutover-root.crt:ro"]
networks:
  reading:
    ipam:
      config:
        - subnet: 10.242.51.0/24
EOF
compose_provider=(docker compose --project-name "$provider_project" --env-file "$tmpdir/provider.env" -f "$root/compose.identity.production.yaml" -f "$tmpdir/provider.override.yaml")
compose_reading=(docker compose --project-name "$reading_project" --env-file "$tmpdir/reading.env" -f "$reading_repo/compose.production.yaml" -f "$tmpdir/reading.override.yaml")
compose_legacy=(docker compose --project-name "$legacy_project" --env-file "$tmpdir/legacy.env" -f "$legacy_repo/compose.production.yaml" -f "$tmpdir/legacy.override.yaml")
missing_provider_volume="${project}-missing-identity"
missing_reading_volume="${project}-missing-reading"
if IDENTITY_DB_VOLUME="$missing_provider_volume" "${compose_provider[@]}" up -d db >/dev/null 2>&1; then echo 'Missing provider volume unexpectedly started.' >&2; exit 1; fi
if READING_DB_VOLUME="$missing_reading_volume" "${compose_reading[@]}" up -d db >/dev/null 2>&1; then echo 'Missing Reading volume unexpectedly started.' >&2; exit 1; fi
if docker volume inspect "$missing_provider_volume" >/dev/null 2>&1 || docker volume inspect "$missing_reading_volume" >/dev/null 2>&1; then echo 'Compose created a substitute external volume.' >&2; exit 1; fi

for volume in "$provider_volume" "$reading_volume"; do
  owners=$(docker ps -q --filter "volume=$volume" | wc -l)
  [[ $owners == 1 ]] || { echo "Expected exactly one old PostgreSQL owner on $volume; refusing dual ownership." >&2; exit 1; }
done

# Copy, never write, the trusted synthetic CA; Reading services use this copy to verify issuer TLS.
docker run --rm --entrypoint /bin/sh -v "$ca_data:/source:ro" -v "$tmpdir:/rehearsal" caddy:2.10.0-alpine -ec "cp -a /source /rehearsal/caddy-data && chown -R $(id -u):$(id -g) /rehearsal/caddy-data"
chmod -R u+rwX,go-rwx "$tmpdir/caddy-data"
[[ -f "$tmpdir/caddy-data/caddy/pki/authorities/local/root.crt" ]] || { echo 'Trusted CA data copy lacks the local root certificate.' >&2; exit 1; }
cmp -s "$ca_cert" "$tmpdir/caddy-data/caddy/pki/authorities/local/root.crt" || { echo 'CA certificate does not match the copied synthetic CA data.' >&2; exit 1; }
cp "$ca_cert" "$tmpdir/cutover-root.crt"
chmod 600 "$tmpdir/cutover-root.crt"

docker stop "$provider_old" "$reading_old" >/dev/null
docker rm "$provider_old" "$reading_old" >/dev/null
"${compose_legacy[@]}" up --build -d --wait auth web reading-backend reading-frontend
legacy_provider_db=$("${compose_legacy[@]}" ps -q db)
legacy_reading_db=$("${compose_legacy[@]}" ps -q reading-db)
[[ $(docker inspect --format '{{range .Mounts}}{{if eq .Destination "/var/lib/postgresql/data"}}{{.Name}}{{end}}{{end}}' "$legacy_provider_db") == "$provider_volume" ]] || { echo 'Legacy provider stack mounted a substitute volume.' >&2; exit 1; }
[[ $(docker inspect --format '{{range .Mounts}}{{if eq .Destination "/var/lib/postgresql/data"}}{{.Name}}{{end}}{{end}}' "$legacy_reading_db") == "$reading_volume" ]] || { echo 'Legacy Reading stack mounted a substitute volume.' >&2; exit 1; }

cat >"$tmpdir/legacy.Caddyfile" <<EOF
{
  local_certs
}
$identity_host {
  @identity path /api/auth/* /.well-known/* /oauth2/* /health/*
  handle @identity {
    reverse_proxy host.docker.internal:$identity_auth_port
  }
  handle {
    reverse_proxy host.docker.internal:$identity_port
  }
}
$reading_host {
  @readingBackend path /api/* /socket.io/*
  handle @readingBackend {
    reverse_proxy host.docker.internal:$reading_backend_port
  }
  handle {
    reverse_proxy host.docker.internal:$reading_frontend_port
  }
}
$bidding_host {
  reverse_proxy $bidding_upstream
}
EOF
cat >"$tmpdir/neutral.Caddyfile" <<EOF
{
  local_certs
}
EOF
cat "$edge_repo/Caddyfile" >>"$tmpdir/neutral.Caddyfile"
printf '\n%s {\n  reverse_proxy %s\n}\n' "$bidding_host" "$bidding_upstream" >>"$tmpdir/neutral.Caddyfile"


browser_proof() {
  local config=$1 container=$2
  docker run -d --name "$container" --add-host host.docker.internal:host-gateway -p "127.0.0.1:$https_port:443" -e "AUTH_DOMAIN=$identity_host" -e "READING_DOMAIN=$reading_host" -e "AUTH_UPSTREAM=host.docker.internal:$identity_auth_port" -e "PORTAL_UPSTREAM=host.docker.internal:$identity_port" -e "READING_FRONTEND_UPSTREAM=host.docker.internal:$reading_frontend_port" -e "READING_BACKEND_UPSTREAM=host.docker.internal:$reading_backend_port" -v "$tmpdir/$config:/etc/caddy/Caddyfile:ro" -v "$tmpdir/caddy-data:/data" caddy:2.10.0-alpine >/dev/null
  for _ in {1..30}; do curl --fail --silent --cacert "$ca_cert" --resolve "$identity_host:$https_port:127.0.0.1" "https://$identity_host:$https_port/health/ready" >/dev/null 2>&1 && break; sleep 1; done
  curl --fail --silent --show-error --cacert "$ca_cert" --resolve "$identity_host:$https_port:127.0.0.1" "https://$identity_host:$https_port/api/auth/.well-known/openid-configuration" >"$tmpdir/discovery.json" || { docker logs "$container" >&2; return 1; }
  EXPECTED_ISSUER="https://$identity_host:$https_port/api/auth" node -e 'const d=JSON.parse(require("node:fs").readFileSync(process.argv[1]));if(d.issuer!==process.env.EXPECTED_ISSUER)process.exit(1)' "$tmpdir/discovery.json"
  curl --fail --silent --show-error --cacert "$ca_cert" --resolve "$bidding_host:$https_port:127.0.0.1" -o /dev/null "https://$bidding_host:$https_port/dashboard" || { docker logs "$container" >&2; return 1; }
  CENTRAL_IDENTITY_TEST_EMAIL="$(node -e 'process.stdout.write(JSON.parse(require("node:fs").readFileSync(process.argv[1])).email)' "$test_user_file")" \
  CENTRAL_IDENTITY_TEST_PASSWORD="$(node -e 'process.stdout.write(JSON.parse(require("node:fs").readFileSync(process.argv[1])).password)' "$test_user_file")" \
  BIDDING_OIDC_TEST_ORIGIN="https://$bidding_host:$https_port" \
  READING_OIDC_TEST_ORIGIN="https://$reading_host:$https_port" \
  CENTRAL_IDENTITY_TEST_ORIGIN="https://$identity_host:$https_port" \
  bun "$bidding_repo/scripts/test-oidc-browser.ts"
}

# The edge owner is stopped only after all preflight, backups, restores, and old-app readiness pass.
docker stop "$edge_container" >/dev/null
parent_edge_stopped=1
browser_proof legacy.Caddyfile "$old_ingress"
docker stop "$old_ingress" >/dev/null; docker rm "$old_ingress" >/dev/null

"${compose_legacy[@]}" stop auth web reading-backend reading-frontend db reading-db
for volume in "$provider_volume" "$reading_volume"; do
  [[ $(docker ps -q --filter "volume=$volume" | wc -l) == 0 ]] || { echo "Legacy PostgreSQL owner still runs on $volume." >&2; exit 1; }
done
"${compose_provider[@]}" up --build -d --wait
provider_db_container=$("${compose_provider[@]}" ps -q db)
provider_mounted_volume=$(docker inspect --format '{{range .Mounts}}{{if eq .Destination "/var/lib/postgresql/data"}}{{.Name}}{{end}}{{end}}' "$provider_db_container")
[[ $provider_mounted_volume == "$provider_volume" ]] || { echo 'Independent provider Compose mounted a different volume.' >&2; exit 1; }
docker exec "$provider_db_container" psql -U central -d central -Atc 'SELECT md5(string_agg(id || chr(58) || email, chr(44) ORDER BY id)) FROM "user"' | grep -Fx "$provider_user_digest" >/dev/null
docker exec "$provider_db_container" psql -U central -d central -Atc 'SELECT md5(string_agg(client_id || chr(58) || array_to_string(redirect_uris, chr(44)), chr(44) ORDER BY client_id)) FROM oauth_client' | grep -Fx "$provider_client_digest" >/dev/null
"${compose_reading[@]}" up -d db
"${compose_reading[@]}" run --rm --no-deps backend npm exec -- drizzle-kit migrate
"${compose_reading[@]}" up --build -d --wait
reading_db_container=$("${compose_reading[@]}" ps -q db)
reading_mounted_volume=$(docker inspect --format '{{range .Mounts}}{{if eq .Destination "/var/lib/postgresql/data"}}{{.Name}}{{end}}{{end}}' "$reading_db_container")
[[ $reading_mounted_volume == "$reading_volume" ]] || { echo 'Independent Reading Compose mounted a different volume.' >&2; exit 1; }
docker exec "$reading_db_container" psql -U reading -d reading -Atc 'SELECT md5(string_agg(id || chr(58) || email, chr(44) ORDER BY id)) FROM "user"' | grep -Fx "$reading_user_digest" >/dev/null
docker exec "$reading_db_container" psql -U reading -d reading -Atc 'SELECT md5(string_agg(id || chr(58) || title, chr(44) ORDER BY id)) FROM books' | grep -Fx "$reading_content_digest" >/dev/null
browser_proof neutral.Caddyfile "$new_ingress"
session_rows_preserved "$provider_db_container" central central "$provider_sessions_snapshot"
session_rows_preserved "$reading_db_container" reading reading "$reading_sessions_snapshot"
docker stop "$new_ingress" >/dev/null; docker rm "$new_ingress" >/dev/null

# Roll back route and service ownership to the exact same cloned legacy data.
"${compose_provider[@]}" stop auth web db
"${compose_reading[@]}" stop frontend backend db
for volume in "$provider_volume" "$reading_volume"; do
  [[ $(docker ps -q --filter "volume=$volume" | wc -l) == 0 ]] || { echo "Independent PostgreSQL owner still runs on $volume." >&2; exit 1; }
done
"${compose_legacy[@]}" up --build -d --wait auth web reading-backend reading-frontend
browser_proof legacy.Caddyfile "$old_ingress"
legacy_provider_db=$("${compose_legacy[@]}" ps -q db)
legacy_reading_db=$("${compose_legacy[@]}" ps -q reading-db)
session_rows_preserved "$legacy_provider_db" central central "$provider_sessions_snapshot"
session_rows_preserved "$legacy_reading_db" reading reading "$reading_sessions_snapshot"
docker stop "$old_ingress" >/dev/null; docker rm "$old_ingress" >/dev/null
"${compose_legacy[@]}" stop auth web reading-backend reading-frontend db reading-db
docker start "$edge_container" >/dev/null
parent_edge_stopped=0

echo 'Synthetic old-to-independent cutover and rollback rehearsal passed; disposable PostgreSQL volumes only.'
