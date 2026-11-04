# Central Identity local proof

This repository runs a local Elysia + Better Auth identity provider with PostgreSQL-backed users and sessions. It is for controlled local testing only; do not deploy the sample secrets or open registration policy.

## Prerequisites

- Docker Engine with the Compose plugin
- Bun 1.4.2 or newer (matches the committed lockfile and runs the public HTTP regression tests)
- Port 443 available

The provider is served over HTTPS at `https://auth.127.0.0.1.nip.io`. That hostname resolves to loopback through nip.io DNS. Caddy creates a local CA and issues the HTTPS certificate; import that CA into the host/browser trust store before opening the site or running tests.

## Start

```sh
docker compose --env-file .env.example up --build
```

Compose runs PostgreSQL and Mailpit, applies the committed Drizzle migrations before starting the provider, then starts Caddy on port 443. PostgreSQL data is retained in the `central-db` volume across provider restarts. The test email inbox is at <http://localhost:8025>.

Export and trust Caddy's local CA once after Caddy has started:

```sh
docker compose cp caddy:/data/caddy/pki/authorities/local/root.crt ./central-identity-root.crt
sudo cp central-identity-root.crt /usr/local/share/ca-certificates/central-identity-local.crt
sudo update-ca-certificates
```

For browsers with a separate certificate store, import `central-identity-root.crt` there as a trusted certificate authority. Restart the browser after importing. Do not share the private CA key or use this CA outside local development.

Open <https://auth.127.0.0.1.nip.io>, register a controlled test address, open the verification link in Mailpit, then sign in. The provider requires email verification before password sign-in. A successful sign-in establishes a database-backed Central SSO Session in a secure, host-only cookie.

**Sign out of Central Identity** on the provider page ends only the Central
SSO Session. It prevents a fresh OIDC authorization from silently reusing that
session, but it does not revoke already-issued Book Bidding or Read in Peace
Application Sessions. Sign out in each application separately when needed.

## Book Bidding OIDC demo

Use the sibling repository at `../book-bidding` with the exact public callback `https://bidding.127.0.0.1.sslip.io/api/auth/callback/central-identity`. The client is confidential (`client_secret_basic`), first-party, authorization-code-only, and PKCE-required. Client provisioning is a local operator command, not an HTTP endpoint:

The canonical issuer is `https://auth.127.0.0.1.nip.io/api/auth`; its OpenID Connect discovery document is at `https://auth.127.0.0.1.nip.io/api/auth/.well-known/openid-configuration`.

```sh
cp .env.example .env
cp ../book-bidding/.env.example ../book-bidding/.env
printf 'BETTER_AUTH_SECRET=%s\n' "$(openssl rand -base64 32)" >> ../book-bidding/.env
docker compose --env-file .env up -d db mailpit
docker compose --env-file .env run --rm --no-deps auth bun run provision:bidding
```

The command prints a one-time client ID and secret. Before starting the provider, put only the printed client ID in `BIDDING_OIDC_CLIENT_ID` in this repository's ignored `.env`; put both printed credentials in `../book-bidding/.env` as `CENTRAL_OIDC_CLIENT_ID` and `CENTRAL_OIDC_CLIENT_SECRET`. Keep both files private (`chmod 600 .env ../book-bidding/.env`) and do not commit or paste the secret elsewhere. The provider loads that ID into its trusted-client cache on startup. Provisioning marks this first-party client `skip_consent: true`, so an authenticated user can complete authorization without a separate consent screen; other untrusted clients are not provisioned. The CLI uses and removes a random temporary identity to authenticate the privileged client-creation request. Ordinary users cannot create, update, delete, list, read, or rotate OAuth clients, and dynamic registration is disabled.

Start the provider and TLS proxy:

```sh
docker compose --env-file .env up --build -d
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

The test drives the public HTTPS browser redirect and confirms the resulting local session. Install Chromium once with `bunx playwright install chromium` (on an unsupported Ubuntu 26.04 host, use `PLAYWRIGHT_HOST_PLATFORM_OVERRIDE=ubuntu24.04-x64 bunx playwright install chromium`). The Caddy CA trust setup above is required; local sign-in credentials and client secrets stay in ignored `.env` files.

## Read in Peace OIDC demo

Use the sibling repository at `../read-in-peace` with the exact public callback
`https://reading.lvh.me/api/auth/callback/central-identity`. Copy its backend
environment file and provision its confidential, first-party client:

```sh
cp ../read-in-peace/backend/.env.example ../read-in-peace/backend/.env
docker compose --env-file .env up -d db mailpit
docker compose --env-file .env run --rm --no-deps auth bun run provision:reading
```

The command prints a one-time client ID and secret. Set only the ID as
`READING_OIDC_CLIENT_ID` in this repository's ignored `.env`; set both values
in `../read-in-peace/backend/.env` as `CENTRAL_IDENTITY_CLIENT_ID` and
`CENTRAL_IDENTITY_CLIENT_SECRET`. Protect both files with `chmod 600` and do
not commit or share the secret. The provider loads the client ID as trusted on
startup.
Provisioning marks it `skip_consent: true` and uses/removes a random temporary
identity to authenticate the privileged CLI operation.

Start Read in Peace's PostgreSQL and backend migrations, then run its backend
and frontend with the `reading.lvh.me` URLs described in its README. Opening
**Continue with Central Identity** creates an independent Reading Application
Session; signing out of Reading does not sign out Book Bidding or Central
Identity.

For a persistent public-browser regression across both apps, provision both
clients, start all three applications, and run the opt-in Book Bidding test
with a verified Central Identity:

```sh
cd ../book-bidding
NODE_EXTRA_CA_CERTS=../book-auth-middleware/central-identity-root.crt VITE_OIDC_TEST_EMAIL='new-address@example.test' VITE_OIDC_TEST_PASSWORD='the verified identity password' bun run test:unit -- --run src/tests/oidc-cross-app.test.ts
```

It signs into both apps through the public HTTPS flow, confirms their Application
Sessions are distinct, and verifies that either app can sign out without
affecting the other. It then signs out centrally, confirms both existing app
sessions remain active, and checks that a fresh authorization prompts for the
Central Identity password. The same Caddy CA trust and Chromium setup described
above are required.

## Disabling a Central Identity

An operator can prevent a Central Identity from starting new OIDC authorizations, including when its Central SSO Session already exists:

```sh
CENTRAL_IDENTITY_EMAIL='person@example.test' bun run disable:central-identity
```

Run this local CLI only with operator access to the provider database. There is no user-facing disable endpoint. Disabling marks the Central Identity disabled and revokes its Central SSO Sessions, which also invalidates outstanding authorization codes. Application Sessions already issued by Book Bidding or another application are untouched and remain usable until their own expiry or independent revocation.
To recover a forgotten password, use **Forgot your password?** on the sign-in page and submit the account email. The page gives the same confirmation whether or not that address is registered; check Mailpit for the reset link. Open it, choose a new password, and sign in with it. Reset links are one-time and expire after one hour; only the link is emailed, never the password.

## Verify the public behavior

With Compose running from the auth repository root and the local CA trusted:

```sh
curl https://auth.127.0.0.1.nip.io/health/live
curl https://auth.127.0.0.1.nip.io/health/ready
. ../book-bidding/.env
export BIDDING_OIDC_CLIENT_ID="$CENTRAL_OIDC_CLIENT_ID"
export BIDDING_OIDC_CLIENT_SECRET="$CENTRAL_OIDC_CLIENT_SECRET"
bun run test
```

The Bun suite uses public HTTP endpoints: it checks discovery/JWKS, unknown clients and redirects, failed S256 PKCE, authorization-code replay, disabled dynamic registration, and anonymous/ordinary-user client CRUD denial. It issues a valid authorization code before operator disable, then verifies that code cannot be exchanged, the Central SSO Session is revoked, a fresh sign-in cannot authorize, and application sessions are not part of the provider-side revocation. The test invokes the operator-only CLI against the same database; it requires the provisioned client ID and secret exported from `../book-bidding/.env`. Tests create unique addresses and restart the `auth` container. `TEST_PROVIDER_URL` and `TEST_MAILPIT_URL` can override the defaults.

Readiness checks PostgreSQL and returns HTTP 503 when the database is unavailable; liveness only reports whether the provider process responds. Password sign-ins emit JSON success or failure events, and completed OIDC authorizations emit a success event. These events contain only event name, action, and status—never credentials, authorization codes, cookies, tokens, or raw URLs.
To exercise database-dependent readiness failure while keeping the provider process live:

```sh
docker compose stop db
curl -i https://auth.127.0.0.1.nip.io/health/live  # HTTP 200
curl -i https://auth.127.0.0.1.nip.io/health/ready # HTTP 503
docker compose start db
```

Wait until PostgreSQL is healthy again before resuming requests.


## Database changes

Committed SQL migrations are under `src/db/migrations` and are applied on every startup. After changing `src/schema.ts`, generate and commit a migration with:

```sh
bun run db:generate
```

Stop local services with `docker compose down`; use `docker compose down -v` only when intentionally deleting the local database and Caddy CA volumes.
