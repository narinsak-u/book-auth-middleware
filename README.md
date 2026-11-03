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

## Verify the public behavior

With Compose running and the local CA trusted:

```sh
curl https://auth.127.0.0.1.nip.io/health/live
curl https://auth.127.0.0.1.nip.io/health/ready
bun run test
```

The Bun test uses the provider's HTTP API and Mailpit's capture API to register, prove unverified sign-in is refused, follow the actual email verification link, sign in, retrieve the Central SSO Session across a Docker Compose provider restart, and prove sign-out invalidates it. It creates a unique test address on each run and restarts the `auth` container. `TEST_PROVIDER_URL` and `TEST_MAILPIT_URL` can override the defaults.

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
