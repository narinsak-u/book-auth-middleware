# Central Identity

This repository runs an Elysia + Better Auth identity provider, PostgreSQL, and
an Authentication Portal. Development and production use separate encrypted
environment files and separate Compose stacks. Do not use local open enrollment,
Mailpit, or the local certificate authority in a production deployment.

## Local development

Install Bun 1.4.2 or newer and Docker Engine with Compose. Port 443 must be
available. The provider is served over HTTPS at
`https://auth.127.0.0.1.nip.io`; that hostname resolves to loopback. Caddy
creates a local CA, which must be trusted by the host and browser.

Install the pinned tools and start the development stack:

```sh
bun install --frozen-lockfile
bunx dotenvx run --strict --overload -f .env.development -- docker compose --env-file /dev/null up --build
```
The `web` container writes generated files as UID/GID 1000 by default; set
`LOCAL_UID` and `LOCAL_GID` to your host IDs before the command above if
different, so local builds can also write to the checkout.

Compose runs five local services: PostgreSQL, Mailpit, the Elysia/Better Auth
server (`auth`), the TanStack Start Authentication Portal (`web`), and Caddy.
The two Bun processes run separately behind Caddy on the unchanged public
HTTPS hosts: `https://auth.127.0.0.1.nip.io` for Central Identity,
`https://bidding.127.0.0.1.sslip.io` for Book Bidding, and
`https://reading.lvh.me` for Read in Peace. Caddy sends portal pages to `web`
and Better Auth protocol, discovery/JWKS, and health traffic to `auth`.
PostgreSQL stays private. The root `build`, `typecheck`, and `test` commands run
through Turborepo. Compose applies the committed migrations before starting
`auth`; migration failure prevents the server from starting. PostgreSQL data
remains in the existing `central-db` volume. This workspace cutover adds no
schema migration and must not recreate that volume.

Before applying any future database migration to populated data, make and
verify an operator-controlled backup:

```sh
bunx dotenvx run --strict --overload -f .env.development -- docker compose --env-file /dev/null exec -T db pg_dump -U central -d central --format=custom > central-before-migration.dump
pg_restore --list central-before-migration.dump
```

Keep the private `.env.keys` file backed up and outside Git: without its
development private key, committed `.env.development` cannot be decrypted.
Keep the database volume and existing client IDs/secrets stable across restarts.
Use `bunx dotenvx run --strict --overload -f .env.development -- docker compose --env-file /dev/null down`
to stop services without removing data; never use `down -v` unless intentionally
deleting the local database and Caddy CA. Mailpit is at
<http://localhost:8025>; it is local-only.

Enrollment is invitation-only. An operator issues a local invitation with
`bunx dotenvx run --strict --overload -f .env.development -- bun run --filter @central-identity/server issue:enrollment-invitation -- person@example.test`;
open the invitation from Mailpit and create the identity, then verify email
before signing in. `/forgot-password` returns the same confirmation whether or
not an address is registered; open its Mailpit reset link at `/reset-password`
and choose a new password. Reset links are one-time and expire after one hour.
Do not expose enrollment or these Mailpit-backed flows outside local development.

Successful sign-in establishes a database-backed Central SSO Session in a
secure, host-only cookie. **Sign out of Central Identity** on the portal ends
only that session. It prevents a fresh OIDC authorization from silently
reusing it, but it does not revoke Book Bidding or Read in Peace Application
Sessions; sign out in each application separately when needed.

Export and trust Caddy's local CA once after Caddy has started:

```sh
docker compose cp caddy:/data/caddy/pki/authorities/local/root.crt ./central-identity-root.crt
sudo cp central-identity-root.crt /usr/local/share/ca-certificates/central-identity-local.crt
sudo update-ca-certificates
```

For browsers with a separate certificate store, import `central-identity-root.crt` there as a trusted certificate authority. Restart the browser after importing. Do not share the private CA key or use this CA outside local development.

Open <https://auth.127.0.0.1.nip.io> to reach the TanStack Authentication
Portal. It provides sign-in, local enrollment, password recovery, and central
sign-out.

## Book Bidding OIDC demo

Use the sibling repository at `../book-bidding` with the exact public callback `https://bidding.127.0.0.1.sslip.io/api/auth/callback/central-identity`. The client is confidential (`client_secret_basic`), first-party, authorization-code-only, and PKCE-required. Client provisioning is a local operator command, not an HTTP endpoint:

The canonical issuer is `https://auth.127.0.0.1.nip.io/api/auth`; its OpenID Connect discovery document is at `https://auth.127.0.0.1.nip.io/api/auth/.well-known/openid-configuration`.

```sh
if [ ! -e ../book-bidding/.env ]; then
  cp ../book-bidding/.env.example ../book-bidding/.env
  printf 'BETTER_AUTH_SECRET=%s\n' "$(openssl rand -base64 32)" >> ../book-bidding/.env
fi
bunx dotenvx run --strict --overload -f .env.development -- docker compose --env-file /dev/null up -d db mailpit
bunx dotenvx run --strict --overload -f .env.development -- docker compose --env-file /dev/null run --rm --no-deps auth bun run provision:bidding
```

The command prints a one-time client ID and secret. Before starting the provider, set only the printed client ID as `BIDDING_OIDC_CLIENT_ID` with `bunx dotenvx set BIDDING_OIDC_CLIENT_ID '<id>' -f .env.development`; put both printed credentials in `../book-bidding/.env` as `CENTRAL_OIDC_CLIENT_ID` and `CENTRAL_OIDC_CLIENT_SECRET`. Keep `.env.keys` and `../book-bidding/.env` private (`chmod 600 .env.keys ../book-bidding/.env`) and do not commit or paste the secret elsewhere. The provider loads that ID into its trusted-client cache on startup. Provisioning marks this first-party client `skip_consent: true`, so an authenticated user can complete authorization without a separate consent screen; other untrusted clients are not provisioned. The CLI uses and removes a random temporary identity to authenticate the privileged client-creation request. Ordinary users cannot create, update, delete, list, read, or rotate OAuth clients, and dynamic registration is disabled.

Start the provider and TLS proxy:

```sh
bunx dotenvx run --strict --overload -f .env.development -- docker compose --env-file /dev/null up --build -d
```

Caddy serves the app's `bidding.127.0.0.1.sslip.io` host over HTTPS and proxies to the Vite server on port 5173. In a second terminal, start Book Bidding from `../book-bidding` using its local `.env`:

```sh
cd ../book-bidding
bun install --frozen-lockfile
bun run db:push
NODE_EXTRA_CA_CERTS=../book-auth-middleware/central-identity-root.crt bun run dev -- --host 0.0.0.0
```

Register a new Central Identity at <https://auth.127.0.0.1.nip.io>, then follow its verification link from <http://localhost:8025>. On `https://bidding.127.0.0.1.sslip.io/auth/login`, choose **Continue with Central Identity**. The app stores the validated OIDC issuer/subject as a Generic OAuth account and creates its own ordinary Application User and host-only Application Session. Existing same-email application users are not linked implicitly; Google, GitHub, and password login remain available.

For the live browser test, use a newly verified central identity that has no existing Book Bidding user. Pass its credentials to the test runner:

```sh
cd ../book-bidding
NODE_EXTRA_CA_CERTS=../book-auth-middleware/central-identity-root.crt VITE_OIDC_TEST_EMAIL='new-address@example.test' VITE_OIDC_TEST_PASSWORD='the verified identity password' bun run test:unit -- --run src/tests/oidc-login.test.ts
```

The test drives the public HTTPS browser redirect and confirms the resulting local session. Install Chromium once with `bunx playwright install chromium` (on an unsupported Ubuntu 26.04 host, use `PLAYWRIGHT_HOST_PLATFORM_OVERRIDE=ubuntu24.04-x64 bunx playwright install chromium`). The Caddy CA trust setup above is required; local sign-in credentials and client secrets stay in the sibling app's ignored `.env` and this provider's encrypted `.env.development`.

## Read in Peace OIDC demo

Use the sibling repository at `../read-in-peace` with the exact public callback
`https://reading.lvh.me/api/auth/callback/central-identity`. Copy its backend
environment file and provision its confidential, first-party client:

```sh
[ -e ../read-in-peace/backend/.env ] || cp ../read-in-peace/backend/.env.example ../read-in-peace/backend/.env
bunx dotenvx run --strict --overload -f .env.development -- docker compose --env-file /dev/null up -d db mailpit
bunx dotenvx run --strict --overload -f .env.development -- docker compose --env-file /dev/null run --rm --no-deps auth bun run provision:reading
```

The command prints a one-time client ID and secret. Set only the ID as
`READING_OIDC_CLIENT_ID` in encrypted `.env.development` with
`bunx dotenvx set READING_OIDC_CLIENT_ID '<id>' -f .env.development`; set both
values in `../read-in-peace/backend/.env` as `CENTRAL_IDENTITY_CLIENT_ID` and
`CENTRAL_IDENTITY_CLIENT_SECRET`. Protect the sibling app's file and `.env.keys`
with `chmod 600` and do not commit or share either secret. The provider loads
the client ID as trusted on startup.
Provisioning marks it `skip_consent: true` and uses/removes a random temporary
identity to authenticate the privileged CLI operation.

Start Read in Peace's PostgreSQL and backend migrations, then run its backend
and frontend with the `reading.lvh.me` URLs described in its README. Opening
**Continue with Central Identity** creates an independent Reading Application
Session; signing out of Reading does not sign out Book Bidding or Central
Identity.

For the opt-in public HTTPS browser regression across both applications,
provision both clients, start the provider and both relying parties, and use a
verified test Central Identity:

```sh
cd ../book-bidding
NODE_EXTRA_CA_CERTS=../book-auth-middleware/central-identity-root.crt VITE_OIDC_TEST_EMAIL='new-address@example.test' VITE_OIDC_TEST_PASSWORD='the verified identity password' bun run test:unit -- --run src/tests/oidc-cross-app.test.ts
```

The suite covers Book Bidding's protected `/account/identity` destination and
Read in Peace's `/dashboard` sign-in prompt, verifying return to each
destination. It confirms the existing Central SSO Session avoids a second
password form, creates distinct Application Sessions, and that either
application can sign out without ending the other's session. It then signs
out centrally, confirms both application sessions remain active, and checks
that a fresh authorization requires Central Identity reauthentication. The
same Caddy CA trust and Chromium setup described above are required.

## Disabling a Central Identity

An operator can prevent a Central Identity from starting new OIDC authorizations, including when its Central SSO Session already exists:

```sh
CENTRAL_IDENTITY_EMAIL='person@example.test' bunx dotenvx run --strict --overload -f .env.development -- docker compose --env-file /dev/null run --rm --no-deps -e CENTRAL_IDENTITY_EMAIL auth bun run disable:central-identity
```

Run this local CLI only with operator access to the provider database. There is no user-facing disable endpoint. Disabling marks the Central Identity disabled and revokes its Central SSO Sessions, which also invalidates outstanding authorization codes. Application Sessions already issued by Book Bidding or another application are untouched and remain usable until their own expiry or independent revocation.

## Verify the public behavior

With Compose running from the auth repository root and the local CA trusted:

```sh
curl https://auth.127.0.0.1.nip.io/health/live
curl https://auth.127.0.0.1.nip.io/health/ready
. ../book-bidding/.env
export BIDDING_OIDC_CLIENT_ID="$CENTRAL_OIDC_CLIENT_ID"
export BIDDING_OIDC_CLIENT_SECRET="$CENTRAL_OIDC_CLIENT_SECRET"
bunx dotenvx run --strict --overload -f .env.development -- bun run test
```

Run `bun run test:env` independently to exercise the Husky encryption and
private-key guard without a running provider.

The Bun suite uses public HTTP endpoints: it checks discovery/JWKS, unknown clients and redirects, failed S256 PKCE, authorization-code replay, disabled dynamic registration, and anonymous/ordinary-user client CRUD denial. It issues a valid authorization code before operator disable, then verifies that code cannot be exchanged, the Central SSO Session is revoked, a fresh sign-in cannot authorize, and application sessions are not part of the provider-side revocation. The test invokes the operator-only CLI against the same database; it requires the provisioned client ID and secret exported from `../book-bidding/.env`. Tests create unique addresses and restart the `auth` container. `TEST_PROVIDER_URL` and `TEST_MAILPIT_URL` can override the defaults.

Readiness checks PostgreSQL and returns HTTP 503 when the database is unavailable; liveness only reports whether the provider process responds. Password sign-ins emit JSON success or failure events, and completed OIDC authorizations emit a success event. These events contain only event name, action, and status—never credentials, authorization codes, cookies, tokens, or raw URLs.
To exercise database-dependent readiness failure while keeping the provider process live:

```sh
bunx dotenvx run --strict --overload -f .env.development -- docker compose --env-file /dev/null stop db
curl -i https://auth.127.0.0.1.nip.io/health/live  # HTTP 200
curl -i https://auth.127.0.0.1.nip.io/health/ready # HTTP 503
bunx dotenvx run --strict --overload -f .env.development -- docker compose --env-file /dev/null start db
```

Wait until PostgreSQL is healthy again before resuming requests.


## Production VM

The committed `.env.development` and `.env.production` are ciphertext, not
Compose env files. `.env.production` intentionally has no deployable domain,
database password, authentication secret, or SMTP credentials until the
operator supplies them. `.env.development.example` and
`.env.production.example` list the respective settings. Keep `.env.keys`
outside Git and back it up in a secure store; a fresh clone needs the
development key to run locally. Put **only** the production key entry from
`.env.keys` on the VM, readable solely by the deployment account. Never copy
the development key to production.

Configure `AUTH_DOMAIN` as the public hostname, `BETTER_AUTH_URL` as
`https://<AUTH_DOMAIN>`, a strong `BETTER_AUTH_SECRET`, a distinct
`POSTGRES_PASSWORD`, and a matching `DATABASE_URL` using the `db` hostname.
Use an authenticated SMTP relay with `SMTP_HOST`, `SMTP_PORT`, `SMTP_FROM`,
`SMTP_USER`, and `SMTP_PASSWORD`. Port 465 uses implicit TLS; other ports
require STARTTLS. Use `bunx dotenvx set KEY value -f .env.production` to
encrypt each setting and commit the encrypted file; keep secrets out of
shell history and command transcripts. DNS must point `AUTH_DOMAIN` to the VM,
and inbound TCP 80/443 (plus UDP 443 for HTTP/3) must reach Caddy to obtain a
public TLS certificate. Do not publish PostgreSQL or SMTP ports.

After securely placing the production decryption key on the VM, start the
isolated production stack:

```sh
bun install --frozen-lockfile
bunx dotenvx run --strict --overload -f .env.production -- docker compose --env-file /dev/null -f compose.production.yaml up --build -d
bunx dotenvx run --strict --overload -f .env.production -- sh -c 'curl "https://$AUTH_DOMAIN/health/ready"'
```

The `--strict` flag prevents startup when decryption fails; Compose also
rejects missing required settings. Images exclude env files and private keys;
the production stack uses its own persistent PostgreSQL and Caddy volumes,
real SMTP instead of Mailpit, and public TLS instead of Caddy's local CA.
Production enrollment is invitation-only in every environment. An operator can
issue an invitation with
`bun run --filter @central-identity/server issue:enrollment-invitation -- person@example.com`;
delivery uses configured SMTP (Mailpit in local development). No open-sign-up
switch exists.

For production Relying Parties, first set `BIDDING_OIDC_REDIRECT_URI` or
`READING_OIDC_REDIRECT_URI` to the application's exact HTTPS callback URL.
Then run `bunx dotenvx run --strict --overload -f .env.production -- docker compose --env-file /dev/null -f compose.production.yaml run --rm --no-deps auth bun run provision:bidding`
or `provision:reading`. Capture each one-time client secret privately in the
Relying Party's production secret store, add only its client ID to encrypted
`.env.production`, and restart `auth` to load the trusted-client cache.
Each Relying Party must use the issuer `https://<AUTH_DOMAIN>/api/auth` and
its own production callback; local client IDs, secrets, and Application
Sessions are not portable between environments.

Back up PostgreSQL before migrations; `down` preserves production volumes,
while `down -v` destroys database and certificate state.

## Database changes

The existing SQL migrations and journal are under `packages/db/src/migrations`;
they are applied by the explicit `bun run db:migrate` step before server
startup. After changing `packages/db/src/schema.ts`, generate and commit a
migration with:

```sh
bun run db:generate
```

Stop local services with `bunx dotenvx run --strict --overload -f .env.development -- docker compose --env-file /dev/null down`; use `down -v` only when intentionally deleting the local database and Caddy CA volumes.
