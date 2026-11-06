# Production VM: Central Identity + Read in Peace

`compose.production.yaml` is the sole owner of public ports 80/443 and Caddy TLS. It runs Central Identity and Reading's SSR frontend, backend, and PostgreSQL on the private `central-identity-production` network. Set `READING_REPO_PATH` to the sibling Reading checkout (default `../read-in-peace`). No production service uses Mailpit or a local CA.

## Operator prerequisites

Before deploying, provide operator-controlled hostnames for Central Identity, Book Bidding, and Read in Peace, public DNS pointing them to the correct provider VM or Vercel project, HTTPS callbacks, and firewalls allowing TCP 80/443 (and UDP 443 if using HTTP/3). Supply authenticated SMTP and independent database, payment, and OIDC credentials. This repository has no owned domain, DNS, SMTP credentials, or Vercel access; none of the public-domain/TLS/email behavior is claimed as verified.

Create the production env file from `.env.production.example` and populate every required value using operator-controlled secrets. Never commit plaintext secrets. Required host settings:

- `AUTH_DOMAIN=identity.<operator-domain>` and `BETTER_AUTH_URL=https://identity.<operator-domain>`
- `READING_DOMAIN=reading.<operator-domain>`
- `READING_OIDC_REDIRECT_URI=https://reading.<operator-domain>/api/auth/callback/central-identity` and `READING_RECOVERY_OIDC_REDIRECT_URI=https://reading.<operator-domain>/api/identity-recovery/callback`.
- `READING_OIDC_CLIENT_ID` and `READING_OIDC_CLIENT_SECRET` from the provisioned Reading relying party; register both exact callbacks above.
- Keep the Book Bidding client separate from Reading: register `https://<bidding-host>/api/auth/callback/central-identity` and `https://<bidding-host>/api/identity-recovery/callback` for its distinct client. Configure `BIDDING_OIDC_REDIRECT_URI` and `BIDDING_RECOVERY_OIDC_REDIRECT_URI` to those exact URLs, then use the same client ID/secret in Central Identity and the Vercel Production runtime.
- `READING_DATABASE_URL` must point to the Reading database using the Reading Postgres credentials. Keep provider `DATABASE_URL` and `POSTGRES_PASSWORD` separate from all Reading database credentials.
- SMTP host, port, sender, authenticated username, and password; use the provider-supported authenticated TLS configuration.

Central Identity now accepts open username/email-password registration with
required email verification. Existing invitation records remain stored but no
longer control signup. Live production social-provider and relying-party
cutover remains unverified: keep Google/GitHub disabled until their separate
callback, SMTP, issuer, backup, and rollback checks pass.

## Operator go-live checklist

Before declaring public production success, require:

- Verified, restorable backups for Central Identity, Read in Peace, and Book Bidding's operator-owned database; test restores in isolation.
- Owned DNS and valid HTTPS for all three application hosts.
- Separate Central Identity client IDs and secrets for Bidding and Reading, with each exact HTTPS callback registered.
- Successful verified credential signup, existing-identity sign-in, and three-app SSO checks.
- Access to the Vercel Production environment and confirmation its protected runtime values match the approved Bidding client and Central Identity issuer.
- A three-app sign-in and sign-out check covering local Application Sessions and Central SSO Session boundaries.

## Synthetic preflight and go-live boundary

Run the synthetic checks before requesting operator credentials:

```sh
# From the provider checkout; exercises synthetic Compose settings and isolated test data.
scripts/production-compose-smoke.sh

# From the Book Bidding checkout; checks private runtime settings, production issuer,
# exact callback derived from the configured Vercel host, and fail-closed missing secrets.
bun run test:unit -- --run src/tests/auth-runtime-settings.test.ts
```

The Compose smoke exercises provider and Reading container health, shared Caddy routing, discovery issuer, Reading auth routing, separate databases, and required-secret failure. The Bidding unit test exercises its private runtime settings contract; it does not prove that the Vercel project has the same values. Local synthetic checks do not verify owned-domain DNS, public HTTPS certificates, authenticated SMTP delivery, real database backups/restores, Vercel deployment settings, or the three-app sign-in/sign-out journey on production. Complete those operator checks before declaring the rollout live. No production database or credential is used by these tests.

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

Do not run the seed command in production. Check `docker compose ... ps` and logs for every service; Caddy must be the only service publishing 80/443. Confirm the provider and Reading host routes, the Central Identity discovery issuer is `https://identity.<operator-domain>/api/auth`, and Reading's OIDC callback equals the registered URI above. Back up the provider and Reading databases independently on a recurring schedule and rehearse restore without attaching a restore volume to the live stack. Book Bidding's database backup is separately operator-owned and must also be verified before deployment.

