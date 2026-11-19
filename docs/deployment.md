# Central Identity production deployment

This runbook covers the standalone Central Identity Compose deployment and the Resend cutover. Public HTTPS ingress remains owned by [`sso-edge`](../../sso-edge/README.md); coordinate that change separately.

**Do not cut over** until the sending domain is verified in Resend, protected production settings are ready, the existing database volume and restore path are confirmed, and both controlled email journeys pass.

## 1. Preflight

1. Schedule a maintenance window with the Central Identity and ingress operators. Record the current release, Compose project name, public issuer, database URL, database volume, and rollback procedure.
2. Take a production database backup and verify that it can be restored. Use the existing backup procedure; do not use `down -v`.
3. Keep the existing `BETTER_AUTH_URL`, `BETTER_AUTH_SECRET`, database credentials, and database volume unchanged. The new Compose file attaches the existing volume as an external volume. Never run two PostgreSQL containers against it at once.
4. Keep the previous SMTP release and its protected settings available throughout the rollback window. Do not overwrite or decrypt the legacy `.env.production` as part of this change.
5. Confirm the production host can make outbound HTTPS requests to Resend and that the `sso-edge` configuration can reach the configured loopback ports.

## 2. Configure Resend

1. Add the production sending domain in Resend.
2. Publish the SPF and DKIM records Resend provides. Merge SPF with any existing SPF policy; do not publish conflicting SPF records. Publish a DMARC policy appropriate for the domain without weakening its current policy.
3. Wait until Resend reports the domain as verified and DNS changes have propagated.
4. Create a minimum-scope Resend API key in the approved secret manager.
5. Choose an `EMAIL_FROM` sender address under the verified domain. Use the same sender for verification and password-reset messages.

## 3. Prepare protected production settings

Run these commands from the repository root. The encrypted deployment file is git-ignored; keep `.env.keys` outside source control and available only to authorized operators.

```sh
umask 077
cp -n .env.identity.production.example .env.identity.production
chmod 600 .env.identity.production .env.keys
```

If `.env.identity.production` already exists, do not replace it with the example. Update it through the approved protected secret-management process. Set every required value from the example:

| Setting | Required value |
| --- | --- |
| `COMPOSE_PROJECT_NAME` | The existing Central Identity production Compose project name. |
| `IDENTITY_DB_VOLUME` | The exact existing PostgreSQL volume name. Do not use the example placeholder or create a new volume. |
| `AUTH_DOMAIN` | The canonical public hostname, without a scheme or path. |
| `BETTER_AUTH_URL` | `https://` plus `AUTH_DOMAIN`; preserve the existing issuer. |
| `BETTER_AUTH_SECRET` | The exact existing production secret. Do not rotate it during this cutover. |
| `DATABASE_URL`, `POSTGRES_PASSWORD` | The existing production database connection and password. |
| `EMAIL_PROVIDER` | `resend`. The production Compose file enforces this provider. |
| `RESEND_API_KEY` | The new key from the approved secret manager. |
| `EMAIL_FROM` | A sender address verified by Resend. |
| `IDENTITY_AUTH_PORT`, `IDENTITY_PORT` | The loopback ports expected by `sso-edge`; defaults are `3000` and `3001`. |

Use a trusted editor or secret-management process to enter secret values. Do not put secrets in shell arguments, command history, logs, or this document. Encrypt the file with the repository's existing dotenvx key:

```sh
bunx dotenvx encrypt -f .env.identity.production -fk .env.keys
git check-ignore .env.identity.production .env.keys
```

The second command must list both files. Do not decrypt or print the encrypted production values.

## 4. Validate and build

The synthetic smoke builds and starts a disposable production-shaped stack. It uses a synthetic Resend key, sends no email, and does not verify real credentials or DNS:

```sh
./scripts/identity-compose-smoke.sh
```

Validate the protected production configuration and build images before the maintenance window:

```sh
bunx dotenvx run --strict --overload \
  -f .env.identity.production -fk .env.keys -- \
  docker compose --env-file /dev/null -f compose.identity.production.yaml config --quiet

bunx dotenvx run --strict --overload \
  -f .env.identity.production -fk .env.keys -- \
  docker compose --env-file /dev/null -f compose.identity.production.yaml build
```

A successful synthetic smoke or Compose config check does not prove that Resend can deliver mail.

## 5. Cut over

1. Confirm the backup, restore path, rollback release, protected SMTP settings, and ingress change owner are ready.
2. Stop the previous Central Identity application and PostgreSQL container using that release's deployment procedure. Preserve the database volume. Do not start the new PostgreSQL container while the old container still has the volume mounted.
3. Start the new release using the same project and external volume values:

```sh
bunx dotenvx run --strict --overload \
  -f .env.identity.production -fk .env.keys -- \
  docker compose --env-file /dev/null -f compose.identity.production.yaml \
  up --detach --wait
```

4. Update or reload `sso-edge` using its operations guide. Keep the auth and portal services bound to loopback; do not expose their Compose ports directly to the Internet.
5. Check the public health endpoint, sign-in page, and issuer. Replace the hostname below with the configured `AUTH_DOMAIN`:

```sh
AUTH_DOMAIN='identity.example.com'
curl --fail --silent --show-error "https://${AUTH_DOMAIN}/health/ready"
curl --fail --silent --show-error "https://${AUTH_DOMAIN}/sign-in" >/dev/null
curl --fail --silent --show-error \
  "https://${AUTH_DOMAIN}/api/auth/.well-known/openid-configuration" |
  jq -e --arg issuer "https://${AUTH_DOMAIN}/api/auth" '.issuer == $issuer'
```

6. Use an approved internal test account and controlled mailbox. Trigger one verification message and one password-reset message through the normal account flow. Confirm both arrive from the verified sender and both links complete successfully. Do not test with arbitrary recipients or production users.
7. Keep the previous release and SMTP settings available until health checks, issuer validation, and both email journeys pass and the rollback window ends.

## 6. Roll back

If health checks, issuer validation, or either email journey fails, coordinate a maintenance window with the ingress operator. Stop the new stack without deleting its external database volume:

```sh
bunx dotenvx run --strict --overload \
  -f .env.identity.production -fk .env.keys -- \
  docker compose --env-file /dev/null -f compose.identity.production.yaml \
  down --remove-orphans
```

Redeploy the previous SMTP release with its preserved protected settings. Verify its health before restoring the previous `sso-edge` upstream. Never use `down -v` or delete/recreate the external Central Identity database volume.
