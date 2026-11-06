# Central Identity

This repository runs an Elysia + Better Auth identity provider, PostgreSQL, and
an Authentication Portal. Development and production use separate encrypted
environment files and separate Compose stacks. Keep local credentials, Mailpit,
and the local certificate authority out of production.

## Local development

For complete three-repository setup and browser tests, follow the
[Development SSO workflow](docs/local-oauth-sso.md).

Install Bun 1.4.2 or newer and Docker Engine with Compose. Port 8080 must be
available. The development origins use HTTPS `.localhost` names:
`https://auth.localhost:8080`, `https://bidding.localhost:8080`, and
`https://reading.localhost:8080`. `.localhost` resolves to loopback in many
resolvers, but WSL and Windows browser resolution can differ; test each in the
actual browser. Caddy creates a local CA that the host, Node processes, and
browser must trust.

Install the pinned tools and start the development stack:

```sh
bun install --frozen-lockfile
bun run dev
```
The `web` container writes generated files as UID/GID 1000 by default; set
`LOCAL_UID` and `LOCAL_GID` to your host IDs before the command above if
different, so local builds can also write to the checkout.

On WSL, `bun run dev` detects the Linux host address for Caddy's sibling-app
proxies; install `iproute2` and `jq` if they are missing. Native Docker hosts
use Docker's `host-gateway` mapping.

Compose runs five local services: PostgreSQL, Mailpit, the Elysia/Better Auth
server (`auth`), the TanStack Start Authentication Portal (`web`), and Caddy.
The two Bun processes run separately behind Caddy on public HTTPS port `8080`:
`https://auth.localhost:8080` for Central Identity,
`https://bidding.localhost:8080` for Book Bidding, and
`https://reading.localhost:8080` for Read in Peace. Caddy sends portal pages
to `web` and Better Auth protocol, discovery/JWKS, and health traffic to `auth`.
PostgreSQL stays private. The root `build`, `typecheck`, and `test` commands run
through Turborepo. Compose applies the committed migrations before starting
`auth`; migration failure prevents the server from starting. PostgreSQL data
remains in the existing `central-db` volume. The username migration adds nullable
username fields and a unique index, preserving all existing identities. Never
recreate that volume.

Before applying any future database migration to populated data, make and
verify an operator-controlled backup:

```sh
bunx dotenvx run --strict --overload -f .env.development -- docker compose --env-file /dev/null exec -T db pg_dump -U central -d central --format=custom > central-before-migration.dump
pg_restore --list central-before-migration.dump
```

Keep private `.env.keys` and `.env.test-production.keys` files backed up outside Git.

Copy `.env.test-production.example` to `.env.test-production`, fill separate
test-only database, OAuth, and secret values, then run
`bun run env:encrypt:test-production`. Use `bun run env:decrypt:test-production`
only while editing it. Development uses `bun run env:decrypt` and
`bun run env:encrypt`. Keep test-production keys separate from development and
live production keys.
The pre-commit hook encrypts staged root environment files; it never decrypts
before commit. Keep the database volume and existing client IDs/secrets stable
across restarts. Use `bun run dev` for the full development Compose stack and
`bun run dev:prod` for the isolated production-mode test stack. Stop either
with the matching encrypted environment:

```sh
bunx dotenvx run --strict --overload -f .env.development -fk .env.keys -- docker compose --env-file /dev/null down
bunx dotenvx run --strict -f .env.test-production -fk .env.test-production.keys -- docker compose --env-file /dev/null --project-name central-test-production -f compose.yaml -f compose.test-production.yaml down
```

Never use `down -v` unless intentionally deleting that environment's database
and Caddy CA. Mailpit is at <http://localhost:8025>; it is local-only.

Central Identity supports open registration with a name, unique normalized
username, email, and password. Email verification is required before credential
sign-in. Invitations no longer gate registration; existing invitation records
remain untouched. Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`,
`GITHUB_CLIENT_ID`, and `GITHUB_CLIENT_SECRET` in the encrypted local
environment to enable provider sign-in. Register these exact callbacks:

- Google: `https://auth.localhost:8080/api/auth/callback/google`
- GitHub: `https://auth.localhost:8080/api/auth/callback/github`

Use a Google email marked verified. For GitHub, grant `user:email`; users with
private email must allow the app to read a verified email or sign-in is refused.
Two provider accounts never merge by email. Link another provider explicitly
from an active Central SSO Session.

### Reviewed recovery

For a Central Identity without a live session, the operator checks the old
Central password and a short-lived Google or GitHub OAuth access token from the
identity owner. Obtain that provider token through an authorized provider OAuth
flow, transfer it privately, and revoke it after recovery. Google needs the
`openid email profile` scopes; GitHub needs `read:user` and `user:email`.
In a private interactive terminal, run:

```sh
bunx dotenvx run --strict --overload -f .env.development -fk .env.keys -- \
  docker compose --env-file /dev/null exec -it auth \
  bun run recover:identity -- 'person@example.test' google
```

The CLI prompts without echoing the old password and access token. It checks
Google OIDC userinfo or GitHub's profile and primary verified email, then shows
the provider account ID, verified email, and target identity before requiring
`LINK <providerAccountId>` confirmation. Matching email alone is not proof;
the operator must verify both accounts belong to the same person, especially
when emails differ. The CLI stores neither access token nor a new session. It
links the provider to the existing Central Identity without deleting its
password credential or existing sessions. The owner signs in normally through
Google or GitHub afterward. Live production keeps its existing recovery path.

Successful sign-in establishes a database-backed Central SSO Session in a
secure, host-only cookie. **Sign out of Central Identity** on the portal ends
only that session. It prevents a fresh OIDC authorization from silently
reusing it, but it does not revoke Book Bidding or Read in Peace Application
Sessions; sign out in each application separately when needed.

Export and trust Caddy's development CA once after Caddy has started:

```sh
docker compose cp caddy:/data/caddy/pki/authorities/local/root.crt ./central-identity-root.crt
sudo cp central-identity-root.crt /usr/local/share/ca-certificates/central-identity-local.crt
sudo update-ca-certificates
```

For Windows browsers under WSL, import the exported public `root.crt` into the
intended current-user Windows Root store. Node apps must use the same root with
`NODE_EXTRA_CA_CERTS`; never disable TLS verification or share the private CA
key. Existing browser sessions and emailed verification/reset links do not
carry over to the new host. Sign in again and request fresh links.

Open <https://auth.localhost:8080> to reach the Authentication Portal.
It provides username/email-password and configured Google/GitHub sign-in,
open verified registration, explicit provider linking, and central sign-out.

## Book Bidding OIDC demo

Use the sibling repository at `../book-bidding` with sign-in callback
`https://bidding.localhost:8080/api/auth/callback/central-identity`
and recovery callback
`https://bidding.localhost:8080/api/identity-recovery/callback`.
Before changing external provider settings, update the operator-owned Google
and GitHub registrations to `https://auth.localhost:8080/api/auth/callback/google`
and `https://auth.localhost:8080/api/auth/callback/github`. If Reviewed Recovery
uses separate Google/GitHub registrations, update those callbacks too. Back up
the Central Identity database before retargeting callbacks; keep current client
IDs/secrets and request fresh email links after the host cutover. Existing
browser sessions do not transfer to the new host. Social and recovery sign-in
remain unverified.

The client is confidential (`client_secret_basic`), first-party,
authorization-code-only, and PKCE-required. Client provisioning is a local
operator command, not an HTTP endpoint:

The canonical issuer is `https://auth.localhost:8080/api/auth`; its OpenID
Connect discovery document is at
`https://auth.localhost:8080/api/auth/.well-known/openid-configuration`.

```sh
bunx dotenvx run --strict --overload -f .env.development -- docker compose --env-file /dev/null up -d db mailpit
bunx dotenvx run --strict --overload -f .env.development -- docker compose --env-file /dev/null run --rm --no-deps auth bun run provision:bidding
```

The command prints a one-time client ID and secret plus both registered callbacks. Before starting the provider, set only the printed client ID as `BIDDING_OIDC_CLIENT_ID` with `bunx dotenvx set BIDDING_OIDC_CLIENT_ID '<id>' -f .env.development`. From `../book-bidding`, use dotenvx to set `CENTRAL_OIDC_CLIENT_ID` and `CENTRAL_OIDC_CLIENT_SECRET` in its encrypted `.env.development`. Keep `.env.keys` private and never commit or paste the client secret. The provider loads its ID into the trusted-client cache on startup. Provisioning marks this first-party client `skip_consent: true`; untrusted clients are not provisioned. The CLI uses and removes a random temporary identity to authenticate its privileged client creation. Ordinary users cannot manage OAuth clients, and dynamic registration is disabled.

Start the provider and TLS proxy:

```sh
bunx dotenvx run --strict --overload -f .env.development -- docker compose --env-file /dev/null up --build -d
```

Caddy serves Book Bidding at `bidding.localhost:8080` and proxies to the Vite server on port 5173. In a second terminal, start Book Bidding from `../book-bidding` using its encrypted `.env.development`:

```sh
cd ../book-bidding
bun install --frozen-lockfile
NODE_EXTRA_CA_CERTS="$(realpath ../book-auth-middleware/central-identity-root.crt)" bun run dev
```

Authenticate at Central Identity with username/email-password after verifying the email, or use a configured Google/GitHub account with verified email. On `https://bidding.localhost:8080/auth/login`, choose **Continue with Central Identity**. The app stores the validated OIDC issuer/subject as a Generic OAuth account and creates its own ordinary Application User and host-only Application Session. Existing same-email application users are not linked implicitly; sign-in credentials remain only at Central Identity.

The browser proof requires verified email for new credential identities and real provider sign-in for Google/GitHub. Keep the Caddy CA trust setup above. Keep app secrets in each app's encrypted `.env.development`, not ignored plaintext `.env`.

## Read in Peace OIDC demo

Use the sibling repository at `../read-in-peace` with sign-in callback
`https://reading.localhost:8080/api/auth/callback/central-identity` and recovery
callback `https://reading.localhost:8080/api/identity-recovery/callback`.
Provision its confidential, first-party client after its encrypted development
environment and private `.env.keys` already exist:

```sh
bunx dotenvx run --strict --overload -f .env.development -- docker compose --env-file /dev/null up -d db mailpit
bunx dotenvx run --strict --overload -f .env.development -- docker compose --env-file /dev/null run --rm --no-deps auth bun run provision:reading
```

The command prints a one-time client ID and secret. Set only the ID as
`READING_OIDC_CLIENT_ID` in encrypted `.env.development` with
`bunx dotenvx set READING_OIDC_CLIENT_ID '<id>' -f .env.development`. From the
Reading repository, set `CENTRAL_IDENTITY_CLIENT_ID` and
`CENTRAL_IDENTITY_CLIENT_SECRET` in its encrypted development environment.
Never commit or share the secret. The provider loads the client ID as trusted
on startup. Provisioning marks it `skip_consent: true` and uses/removes a
random temporary identity to authenticate the privileged CLI operation.

Start Read in Peace's PostgreSQL and backend migrations, then run its backend
and frontend with the `reading.localhost` URLs described in its README. Opening
**Continue with Central Identity** creates an independent Reading Application
Session; signing out of Reading does not sign out Book Bidding or Central
Identity.

For a manual public HTTPS browser smoke, provision both clients, start Central
Identity and both Relying Parties, then sign in through Google or GitHub. Use
an isolated test identity that has no existing application account.

Open a protected Book Bidding page and continue through Central Identity.
Confirm it returns to the original destination. Open Read in Peace in the same
browser profile and confirm its own Application Session is established without
ending the Central SSO Session. Sign out from Central Identity and confirm
both Application Sessions remain active. A fresh authorization must require
Central Identity authentication. Trust Caddy's local CA in the browser first.

## Disabling a Central Identity

An operator can prevent a Central Identity from starting new OIDC authorizations, including when its Central SSO Session already exists:

```sh
CENTRAL_IDENTITY_EMAIL='person@example.test' bunx dotenvx run --strict --overload -f .env.development -- docker compose --env-file /dev/null run --rm --no-deps -e CENTRAL_IDENTITY_EMAIL auth bun run disable:central-identity
```

Run this local CLI only with operator access to the provider database. There is no user-facing disable endpoint. Disabling marks the Central Identity disabled and revokes its Central SSO Sessions, which also invalidates outstanding authorization codes. Application Sessions already issued by Book Bidding or another application are untouched and remain usable until their own expiry or independent revocation.

## Verify the public behavior

With Compose running from the auth repository root and the local CA trusted:

```sh
curl https://auth.localhost:8080/health/live
curl https://auth.localhost:8080/health/ready
bunx dotenvx run --strict --overload -f .env.development -- bun run test
```

The public HTTP suite checks credential registration, duplicate usernames,
verification when Mailpit is configured, username/email sign-in, generic
credential failures, OIDC discovery, and readiness. Provider sign-in and OIDC
callback continuation require the documented real browser checks; tests never
fake provider success.

Readiness checks PostgreSQL and returns HTTP 503 when the database is unavailable; liveness only reports whether the provider process responds. Completed OIDC authorizations emit a success event containing only event name, action, and status—never credentials, authorization codes, cookies, tokens, or raw URLs.
To exercise database-dependent readiness failure while keeping the provider process live:

```sh
bunx dotenvx run --strict --overload -f .env.development -- docker compose --env-file /dev/null stop db
curl -i https://auth.localhost:8080/health/live  # HTTP 200
curl -i https://auth.localhost:8080/health/ready # HTTP 503
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
Test-production enrollment uses Google and GitHub OAuth. Register separate
provider apps and these exact callbacks:

- Google: `https://auth-test.127.0.0.1.nip.io:8081/api/auth/callback/google`
- GitHub: `https://auth-test.127.0.0.1.nip.io:8081/api/auth/callback/github`

Central supports username/email-password registration with required email
verification. Invitation records remain in `enrollment_invitation`; registration
does not read or consume them. The production external-provider and issuer
cutover remains a separate verified phase; Google and GitHub are not enabled by
the current production configuration. The database migration only adds nullable
username columns and a unique index, preserving all current identities.

For production Relying Parties, set both the normal and recovery callback
environment variables to their exact HTTPS URLs. Recovery callbacks must use
`/api/identity-recovery/callback` on the same origin as the normal
`/api/auth/callback/central-identity` callback. Run
`bunx dotenvx run --strict --overload -f .env.production -- docker compose --env-file /dev/null -f compose.production.yaml run --rm --no-deps auth bun run provision:bidding`
or `provision:reading` only after the separate production checks. Each command
registers both callbacks. Capture each one-time client secret privately in the
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
