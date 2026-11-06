# Production VM: Independent Central Identity

Central Identity and Read in Peace run as separate Compose projects with separate PostgreSQL owners and databases. Neutral `sso-edge` owns host Caddy, public TLS, and routing. Book Bidding remains independently deployed on Vercel. The optional shared local-development gateway is unrelated and remains available.

Do not declare production live until every operator gate below passes. No domain, DNS, public certificate, SMTP relay, Vercel project, operator database, or operator credential was available to this synthetic rehearsal.

## Operator-owned go-live gates

Before scheduling cutover, record and independently verify:

- Exact existing provider and Reading Docker volume names; each PostgreSQL major/minor version, database, role, owner, extensions, sizes, and running container/project.
- Existing Central Identities, Identity Links, Application Users, memberships, sessions, OIDC client IDs, approved callback URIs, and disabled-client state. Verify distinct Bidding and Reading clients and protected copies of their credentials.
- Consistent encrypted backups of both databases; `pg_dump --format=custom` each after writes stop, `pg_restore --list` each, and restore each into a separate isolated disposable PostgreSQL instance of its recorded version. Confirm existing user content and record checksums/counts. Never attach restore volumes to live projects.
- Operator-owned DNS for identity, Reading, and Bidding; trusted public TLS; firewall TCP 80/443 (and UDP 443 if HTTP/3); authenticated SMTP delivery; protected Vercel Production environment values; verified Bidding-to-Reading browser sign-in and session boundaries.
- Maintenance window, rollback owner, tested restore plan, and one named service owner for public ports 80/443. Never run both Caddys or both PostgreSQL containers on either preserved volume.

## Separate database backups and restore proof

Set `OLD_PROVIDER_CHECKOUT` and `READING_CHECKOUT` to absolute paths, and `OLD_PROVIDER_PROJECT` to the exact live legacy Compose project name. Run these commands from the new provider checkout. After stopping writes, but before stopping either PostgreSQL owner, set `BACKUP_DIR` to operator-controlled encrypted storage outside all checkouts. Use separate restricted dump files and preserve their checksums:

```sh
umask 077
mkdir -p "$BACKUP_DIR"
./node_modules/.bin/dotenvx run --strict --overload -f "$OLD_PROVIDER_CHECKOUT/.env.production" -- docker compose --project-name "$OLD_PROVIDER_PROJECT" --env-file /dev/null -f "$OLD_PROVIDER_CHECKOUT/compose.production.yaml" exec -T db sh -ec 'PGPASSWORD="$POSTGRES_PASSWORD" pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom' >"$BACKUP_DIR/central-identity.dump"
./node_modules/.bin/dotenvx run --strict --overload -f "$OLD_PROVIDER_CHECKOUT/.env.production" -- docker compose --project-name "$OLD_PROVIDER_PROJECT" --env-file /dev/null -f "$OLD_PROVIDER_CHECKOUT/compose.production.yaml" exec -T reading-db sh -ec 'PGPASSWORD="$POSTGRES_PASSWORD" pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom' >"$BACKUP_DIR/reading.dump"
pg_restore --list "$BACKUP_DIR/central-identity.dump" >/dev/null
pg_restore --list "$BACKUP_DIR/reading.dump" >/dev/null
sha256sum "$BACKUP_DIR/central-identity.dump" "$BACKUP_DIR/reading.dump" >"$BACKUP_DIR/SHA256SUMS"
```

Restore each dump into its own disposable PostgreSQL instance and volume using that database's recorded PostgreSQL image/version, never the live volume. Compare provider `user`, `account` Provider Links, `session`, and `oauth_client` IDs/callbacks with the pre-backup inventory. Compare Reading `user`, `account` Identity Links, `memberships`, `session`, and application content IDs/counts with that inventory. Keep restore logs and checksums with the protected backup record. A successful `pg_restore --list` alone is not restore proof.

This repository has no access to those operator systems. Its local synthetic checks do not satisfy these gates.

## Prepare independent projects

Create protected, mode-0600 `.env.identity.production` from `.env.identity.production.example`. Reconcile its new `COMPOSE_PROJECT_NAME` and exact `IDENTITY_DB_VOLUME` with the existing encrypted `.env.production` credentials; do not rewrite or mass-reset committed encrypted values. Keep both files private. Prepare Reading's protected `.env.production` separately. The provider and Reading Compose definitions require exact external database volumes and fail if names are absent. Keep credentials, issuer, callback URLs, and client records unchanged. Use the existing PostgreSQL versions; do not seed or initialize replacement production databases.

From provider checkout, reconcile the operator-owned encrypted `.env.production` credentials with protected `.env.identity.production` containing the exact project name and existing provider volume. Set mode `0600` on the protected file. Never print either file or commit the plaintext runtime file.

```sh
./node_modules/.bin/dotenvx run --strict --overload -f .env.production -f .env.identity.production -- docker compose --env-file /dev/null -f compose.identity.production.yaml config --quiet
./node_modules/.bin/dotenvx run --strict --overload -f .env.production -f .env.identity.production -- docker compose --env-file /dev/null -f compose.identity.production.yaml build
```

Keep the currently serving legacy Caddy and applications running during validation. Retain the old provider release checkout, its `compose.production.yaml`, `infrastructure/Caddyfile.production`, and Caddy data/config volumes until cutover and rollback gates pass.

During the maintenance window, use the pinned old checkout to stop the one public Caddy owner and both old PostgreSQL owners. Keep the old release and volumes intact:

```sh
./node_modules/.bin/dotenvx run --strict --overload -f "$OLD_PROVIDER_CHECKOUT/.env.production" -- docker compose --project-name "$OLD_PROVIDER_PROJECT" --env-file /dev/null -f "$OLD_PROVIDER_CHECKOUT/compose.production.yaml" stop caddy db reading-db auth web reading-backend reading-frontend
sudo ss -ltnp '( sport = :80 or sport = :443 )'
```

Confirm ports 80/443 are free and one stopped container no longer owns either database volume. Start Central Identity against the exact existing provider volume:

```sh
./node_modules/.bin/dotenvx run --strict --overload -f .env.production -f .env.identity.production -- docker compose --env-file /dev/null -f compose.identity.production.yaml up -d db
./node_modules/.bin/dotenvx run --strict --overload -f .env.production -f .env.identity.production -- docker compose --env-file /dev/null -f compose.identity.production.yaml up -d --wait
```

Start Reading against the exact same external Reading volume from its own checkout:

```sh
./node_modules/.bin/dotenvx run --strict --overload -f "$READING_CHECKOUT/.env.production" -- docker compose --env-file /dev/null -f "$READING_CHECKOUT/compose.production.yaml" up -d db
./node_modules/.bin/dotenvx run --strict --overload -f "$READING_CHECKOUT/.env.production" -- docker compose --env-file /dev/null -f "$READING_CHECKOUT/compose.production.yaml" up -d --wait
```

Check provider `db`, `auth`, `web` and Reading `db`, `backend`, `frontend` readiness separately. Confirm both PostgreSQL versions and mounted volume names. Apply only reviewed migrations after fresh backups and isolated restore rehearsal. Do not seed or run `down -v`. Transfer ingress only after these checks pass.

## Synthetic rehearsal

The rehearsal reads synthetic provider and Reading PostgreSQL source containers, writes separate custom-format dumps, and restores each into isolated PostgreSQL 17.5 volumes. It verifies provider users/approved clients/Provider Links and Reading users/books/Identity Links/memberships across source, restore, independent stacks, and rollback. Link checks compare row identity and ownership without reading secret fields; membership checks compare row identity, user ownership, plan, status, and item limit. Original session rows are checked by ID and hash after cutover and rollback, so browser-created sessions do not invalidate the proof. It uses the exact scratch volumes across legacy and independent Compose owners, with one PostgreSQL owner per volume. Both Reading backends resolve the public identity hostname through Docker's `host-gateway` and trust only a copied synthetic CA. Sequential legacy, neutral-edge, and rollback Caddy containers bind only loopback and route browser SSO at the unchanged issuer/callback origin.

Prerequisites: Docker, Bun, Node, curl; separate provider, Reading, and edge checkouts; retained legacy provider checkout; synthetic PostgreSQL 17.5 source containers with `proof` or `synthetic` in their Compose project names, at least one Reading book row, at least one provider account link, at least one Reading identity link, and at least one Reading membership; a persistent synthetic edge bound only to `127.0.0.1:15443` (`AutoRemove=false`); a healthy Bidding upstream reachable from Docker; trusted synthetic CA data; and a mode-0600 test-user JSON with `email` and `password`. Export protected synthetic values `CUTOVER_PROVIDER_AUTH_SECRET`, `CUTOVER_READING_AUTH_SECRET`, `CUTOVER_BIDDING_CLIENT_ID`, `CUTOVER_READING_CLIENT_ID`, and `CUTOVER_READING_CLIENT_SECRET`. Never use operator databases, volumes, credentials, CA material, or DNS.

The disposable rehearsal networks use `10.242.49.0/24` through `10.242.51.0/24` to avoid WSL host routing collisions. Verify those ranges are free on the rehearsal host; change the script's synthetic subnets if occupied.

Set checkout paths, source container names, and the edge name from the synthetic Docker inventory. Export the listed secrets from protected synthetic settings. Run:

```sh
READING_REPO_PATH=/path/to/read-in-peace \
EDGE_REPO_PATH=/path/to/sso-edge \
BIDDING_REPO_PATH=/path/to/book-bidding \
LEGACY_PROVIDER_CHECKOUT=/path/to/retained/legacy-provider-checkout \
SOURCE_PROVIDER_DB_CONTAINER='<synthetic-provider-db-container>' \
SOURCE_READING_DB_CONTAINER='<synthetic-reading-db-container>' \
CUTOVER_EDGE_CONTAINER='<persistent-synthetic-edge-container>' \
CUTOVER_HTTPS_PORT=15443 \
CUTOVER_ACK_STOP_EDGE='<persistent-synthetic-edge-container>:15443' \
CUTOVER_BIDDING_UPSTREAM='<Docker-reachable-host>:<bidding-port>' \
CENTRAL_IDENTITY_TEST_USER_FILE=/tmp/standalone42-test-user.json \
REHEARSAL_CA_DATA_DIR=/tmp/standalone42-caddy-data \
REHEARSAL_CA_CERT=/tmp/standalone42-ca.crt \
scripts/cutover-rehearsal.sh
```

The required secret variables must be exported from protected synthetic settings before invocation; never place secrets in command arguments or logs. The script rejects non-synthetic source labels, wrong PostgreSQL versions, absent book content or required account-link/membership fixtures, missing external volumes, volume collisions, auto-removed edges, and unacknowledged edge stops. It restores the persistent edge on success or failure and never stops either source database owner.

Standalone provider and Reading smokes remain available as focused checks. The full rehearsal proves synthetic data transfer and browser SSO only; it cannot satisfy operator gates for real DNS, public TLS, SMTP, Vercel, or production backups/restores.

## Rollback and restoration

Before the window, pin `OLD_PROVIDER_CHECKOUT` to the exact previously deployed release. Keep its encrypted `.env.production`, Compose file, Caddyfile, and Caddy data/config volumes intact. `OLD_PROVIDER_PROJECT` must be the exact legacy Compose project name. Save the old Caddy service state and validate both old and new configurations before switching.

Cut over ingress only after new provider and Reading readiness and data checks pass. Stop the legacy container, confirm ports 80/443 are free, then start host Caddy. Never run both listeners:

```sh
./node_modules/.bin/dotenvx run --strict --overload -f "$OLD_PROVIDER_CHECKOUT/.env.production" -- docker compose --project-name "$OLD_PROVIDER_PROJECT" --env-file /dev/null -f "$OLD_PROVIDER_CHECKOUT/compose.production.yaml" stop caddy
sudo ss -ltnp '( sport = :80 or sport = :443 )'
sudo systemctl start caddy
```

Rollback from the new deployment: stop host Caddy and verify ports 80/443 are free. Stop both new PostgreSQL owners before allowing the legacy Compose project to start its dependencies; the old `caddy` service depends on both databases and may start them:

```sh
sudo systemctl stop caddy
sudo ss -ltnp '( sport = :80 or sport = :443 )'
./node_modules/.bin/dotenvx run --strict --overload -f .env.production -f .env.identity.production -- docker compose --env-file /dev/null -f compose.identity.production.yaml stop auth web db
./node_modules/.bin/dotenvx run --strict --overload -f "$READING_CHECKOUT/.env.production" -- docker compose --env-file /dev/null -f "$READING_CHECKOUT/compose.production.yaml" stop frontend backend db
./node_modules/.bin/dotenvx run --strict --overload -f "$OLD_PROVIDER_CHECKOUT/.env.production" -- docker compose --project-name "$OLD_PROVIDER_PROJECT" --env-file /dev/null -f "$OLD_PROVIDER_CHECKOUT/compose.production.yaml" up -d --wait caddy
```

Do not remove old Caddy data/config volumes or the pinned old release checkout. Verify exactly one PostgreSQL container mounts each existing database volume. Never run `down -v` or remove volumes.

If database rollback is required, stop writes and stop new provider `db` before starting legacy `db`. Stop new Reading `db` before starting old `reading-db`; both Compose definitions must reference the exact preserved external volumes. Verify one container mounts each volume before starting its owner. Never run `down -v`, remove volumes, or delete the pinned rollback checkout.

For database recovery, stop writes and the sole PostgreSQL owner, take a fresh independent backup, restore the appropriate backup into a new isolated volume using the recorded PostgreSQL version, and verify identities, links, users/content, sessions, client records, and callbacks. Obtain operator approval before any restore-over-existing or volume switch. Never restore one application's dump into the other database. Restore the original volume only after confirming the replacement PostgreSQL container has detached. Record the cutover and rollback evidence; do not claim production live until all operator-owned gates pass.

## Dynamic OIDC client approval

Provision distinct clients with the operator-only `provision:bidding` and `provision:reading` commands after validating exact HTTPS callbacks. Capture one-time secrets in the relevant protected secret stores. Persisted client records determine current approval and disablement; no process restart is required after client approval or disablement. Keep each Relying Party's client secret backend-only and its callback exact.
