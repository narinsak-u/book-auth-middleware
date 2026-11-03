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

## Book Bidding OIDC demo

Use the sibling worktree at `../bidding-4` with the exact public callback `https://bidding.127.0.0.1.sslip.io/api/auth/callback/central-identity`. The client is confidential (`client_secret_basic`), first-party, authorization-code-only, and PKCE-required. Client provisioning is a local operator command, not an HTTP endpoint:

```sh
cp .env.example .env
cp ../bidding-4/.env.example ../bidding-4/.env
printf 'BETTER_AUTH_SECRET=%s\n' "$(openssl rand -base64 32)" >> ../bidding-4/.env
docker compose --env-file .env up -d db mailpit
docker compose --env-file .env run --rm --no-deps auth bun run provision:bidding
```

The command prints a one-time client ID and secret. Before starting the provider, put only the printed client ID in `BIDDING_OIDC_CLIENT_ID` in this repository's ignored `.env`; put both printed credentials in `../bidding-4/.env` as `CENTRAL_OIDC_CLIENT_ID` and `CENTRAL_OIDC_CLIENT_SECRET`. Keep both files private (`chmod 600 .env ../bidding-4/.env`) and do not commit or paste the secret elsewhere. The provider loads that ID into its trusted-client cache on startup; ordinary users cannot create, update, delete, list, read, or rotate OAuth clients, and dynamic registration is disabled.

Start the provider and TLS proxy:

```sh
docker compose --env-file .env up --build -d
```

Caddy serves the app's `bidding.127.0.0.1.sslip.io` host over HTTPS and proxies to the Vite server on port 5173. In a second terminal, start Book Bidding from `../bidding-4` using its local `.env`:

```sh
cd ../bidding-4
npm install
npm run db:migrate
npm run dev -- --host 0.0.0.0
```

Register a new Central Identity at <https://auth.127.0.0.1.nip.io>, then follow its verification link from <http://localhost:8025>. On `https://bidding.127.0.0.1.sslip.io/auth/login`, choose **Continue with Central Identity**. The app stores the validated OIDC issuer/subject as a Generic OAuth account and creates its own ordinary Application User and host-only Application Session. Existing same-email application users are not linked implicitly; Google, GitHub, and password login remain available.

For the live browser test, use a newly verified central identity that has no existing Book Bidding user. Pass its credentials to the test runner:

```sh
cd ../bidding-4
VITE_OIDC_TEST_EMAIL='new-address@example.test' VITE_OIDC_TEST_PASSWORD='the verified identity password' npm run test:unit -- --run src/tests/oidc-login.svelte.spec.ts
```

The test drives the public HTTPS browser redirect and confirms the resulting local session. The Caddy CA trust setup above is required; local sign-in credentials and client secrets stay in ignored `.env` files.

To recover a forgotten password, use **Forgot your password?** on the sign-in page and submit the account email. The page gives the same confirmation whether or not that address is registered; check Mailpit for the reset link. Open it, choose a new password, and sign in with it. Reset links are one-time and expire after one hour; only the link is emailed, never the password.

## Verify the public behavior

With Compose running and the local CA trusted:

```sh
cd ../auth-4
curl https://auth.127.0.0.1.nip.io/health/live
curl https://auth.127.0.0.1.nip.io/health/ready
set -a
. ../bidding-4/.env
BIDDING_OIDC_CLIENT_ID="$CENTRAL_OIDC_CLIENT_ID"
BIDDING_OIDC_CLIENT_SECRET="$CENTRAL_OIDC_CLIENT_SECRET"
set +a
bun run test
```

The Bun suite uses only public HTTP endpoints: it checks discovery/JWKS, unknown clients and redirects, failed S256 PKCE, authorization-code replay, disabled dynamic registration, and anonymous/ordinary-user client CRUD denial. It also uses Mailpit to verify real Central Identity users and test password recovery for verified and unknown addresses, follow the actual verification and reset links, and confirm one-time reset links reject reuse and the old password. The OIDC protocol test requires the provisioned client ID and secret exported from `../bidding-4/.env`. Tests create unique addresses and restart the `auth` container. `TEST_PROVIDER_URL` and `TEST_MAILPIT_URL` can override the defaults.

To manually check persistence, sign in in a browser, then run `docker compose restart auth` and reload the provider; the existing session remains valid while the database volume is intact. Sign out to prove an invalidated session is rejected. Sessions expire after seven days; an expired cookie is rejected by Better Auth.

Readiness checks PostgreSQL and returns HTTP 503 when the database is unavailable; liveness only reports whether the provider process responds. Failed password sign-ins emit a JSON event containing only event name, action, and status—never submitted credentials, cookies, verification codes, or tokens.
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
