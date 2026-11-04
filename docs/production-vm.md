# Production VM: Central Identity + Read in Peace

`compose.production.yaml` is the sole owner of public ports 80/443 and Caddy TLS. It runs Central Identity and Reading's SSR frontend, backend, and PostgreSQL on the private `central-identity-production` network. Set `READING_REPO_PATH` to the sibling Reading checkout (default `../read-in-peace`). No production service uses Mailpit or a local CA.

## Operator prerequisites

Before deploying, provide controlled hostnames, public DNS pointing both names to this VM, firewall access for TCP 80/443 (and UDP 443 if using HTTP/3), SMTP submission credentials, and independent Reading/Identity/Postgres/payment/OIDC credentials. This repository has no owned domain, DNS, SMTP credentials, or Vercel access; none of the public-domain/TLS/email behavior is claimed as verified.

Create the production env file from `.env.production.example` and populate every required value using operator-controlled secrets. Never commit plaintext secrets. Required host settings:

- `AUTH_DOMAIN=identity.<operator-domain>` and `BETTER_AUTH_URL=https://identity.<operator-domain>`
- `READING_DOMAIN=reading.<operator-domain>`
- `READING_OIDC_REDIRECT_URI=https://reading.<operator-domain>/api/auth/callback/central-identity`
- `READING_OIDC_CLIENT_ID` and `READING_OIDC_CLIENT_SECRET` from the provisioned Reading relying party; register the exact callback above.
- `READING_DATABASE_URL` must point to the Reading database using the Reading Postgres credentials. Keep provider `DATABASE_URL` and `POSTGRES_PASSWORD` separate from all Reading database credentials.
- SMTP host, port, sender, authenticated username, and password; use the provider-supported authenticated TLS configuration.

Keep `ALLOW_SIGN_UP` unset: provider invitation gating is enforced by the application and this deployment does not restore the legacy toggle.

## Preserve Reading database and user data

Do not start Compose until the operator has identified the existing Reading Docker volume and database credentials. Set `READING_DB_VOLUME` to the exact existing volume name; Compose declares it external, so it refuses to create or initialize a substitute volume. Confirm the `READING_POSTGRES_*` values and `READING_DATABASE_URL` match the database already stored there. The local development volume `reading-postgres` is not the production database.

Before changing images, database configuration, or applying migrations:

1. Schedule a maintenance window and stop Reading writes.
2. Record the exact volume name and PostgreSQL version. Take a consistent `pg_dump --format=custom` backup (and, where required, a VM/storage snapshot) to operator-controlled encrypted storage.
3. Verify the dump with `pg_restore --list`; record a restore procedure and verify the backup is restorable in an isolated disposable database.
4. Keep existing Application Users, memberships, Central Identities, OAuth client records, and sessions in that database. Do not run the seed command, `docker compose down -v`, volume removal, restore-over-existing, or a fresh-volume cutover. Take a fresh backup before migration; inspect and test each pending Drizzle migration against a restored copy first.

With both checkouts adjacent, run Compose through dotenvx so it receives decrypted variables; never pass the encrypted dotenvx file directly as Compose's `--env-file`. Review resolved service/volume names without publishing output (it contains secrets). Build and start after the backup and migration plan are approved:

```sh
./node_modules/.bin/dotenvx run --strict --overload -f .env.production -- docker compose --env-file /dev/null -f compose.production.yaml config --quiet
./node_modules/.bin/dotenvx run --strict --overload -f .env.production -- docker compose --env-file /dev/null -f compose.production.yaml build
./node_modules/.bin/dotenvx run --strict --overload -f .env.production -- docker compose --env-file /dev/null -f compose.production.yaml up -d db reading-db
# Verify the expected existing volume is mounted and both databases are healthy.
./node_modules/.bin/dotenvx run --strict --overload -f .env.production -- docker compose --env-file /dev/null -f compose.production.yaml run --rm reading-backend npm exec -- drizzle-kit migrate
./node_modules/.bin/dotenvx run --strict --overload -f .env.production -- docker compose --env-file /dev/null -f compose.production.yaml up -d --wait
```

Do not run the seed command in production. Check `docker compose ... ps` and logs for every service; Caddy must be the only service publishing 80/443. Confirm both hostnames route, the Central Identity discovery issuer is `https://identity.<operator-domain>`, and Reading's OIDC callback equals the registered URI above. Back up both databases independently on a recurring schedule and rehearse restore without attaching a restore volume to the live stack.

## Synthetic non-production proof

Run `scripts/production-compose-smoke.sh` from the provider checkout with Docker available. It supplies synthetic `.localhost` settings, checks Compose rejects missing required configuration, builds and waits for container health, then checks both host routes, the issuer, and the Reading OIDC redirect URI. The script creates and removes only a uniquely named disposable Reading volume and Compose project; it does not use operator env files, DNS, SMTP credentials, or production data. Its `curl --insecure` is limited to this synthetic local-Caddy proof and is not a production TLS check. Public DNS, certificate issuance, and authenticated SMTP delivery remain unverified until operator resources exist.
