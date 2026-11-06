# Development SSO workflow

Run these commands from three sibling repositories: `book-auth-middleware/`,
`book-bidding/`, and `read-in-peace/`. This workflow is for development.
Open Central Identity registration and username/email-password sign-in are
available in development. Preserve existing databases and Compose volumes;
never run `down -v` or reseed them just to test SSO.

## How sign-in works

1. Book Bidding or Read in Peace starts OIDC from its own Sign In entry point.
   The browser reaches Central Identity at
   `https://auth.localhost:8080/api/auth`.
2. Central Identity accepts username or email and password. New credential
   identities verify email before sign-in. Google and GitHub require separate
   operator-owned provider registrations and are not part of the verified
   cross-app browser flow described below.
3. Central returns an authorization code to the requesting application's
   registered callback. The application validates it and creates its own
   Application Session for its own Application User. Matching email alone
   never claims an existing application user.
4. The browser can reuse its Central SSO Session at the other application,
   which creates a separate Application Session without another credential
   prompt. Local application logout ends only that application's session.
   Central logout ends the Central SSO Session; it does not revoke existing
   Application Sessions.

| Service | Development process | Public HTTPS origin |
| --- | --- | --- |
| Central Identity | Auth and portal in Compose | `https://auth.localhost:8080` |
| Book Bidding | SvelteKit on `:5173` | `https://bidding.localhost:8080` |
| Read in Peace | Nest on `:3000`, Nuxt on `:3001` | `https://reading.localhost:8080` |

Caddy serves these `.localhost` origins through the loopback-only gateway on
`:8080`. `.localhost` usually resolves to loopback, but WSL's Linux resolver
and the Windows browser may resolve it differently. Check in the actual
browser; do not add public DNS or expose the gateway. Caddy routes portal pages
to `web` and protocol, metadata, and health paths to `auth`. On WSL, Central's
`dev` script finds the host address for sibling-app proxies; install `iproute2`
and `jq` if missing.

## 1. Register external providers and configure Central

Create **development-only** Google and GitHub OAuth registrations. Configure
their exact authorized callback URLs:

- Google: `https://auth.localhost:8080/api/auth/callback/google`
- GitHub: `https://auth.localhost:8080/api/auth/callback/github`

Grant GitHub `read:user` and `user:email`; private GitHub email must be returned
as verified. Add your Google test account to the OAuth consent screen's test
users if that registration is in testing mode. These are external provider
registrations, not the two Central-to-application OIDC clients below. Do not
reuse Book Bidding's direct Google/GitHub credentials.

From `book-auth-middleware/`, install dependencies. Decrypt `.env.development`
with its existing private `.env.keys`, edit `GOOGLE_CLIENT_ID`,
`GOOGLE_CLIENT_SECRET`, `GITHUB_CLIENT_ID`, and `GITHUB_CLIENT_SECRET` in a
private editor, then encrypt it before staging changes:

```sh
bun install --frozen-lockfile
bun run env:decrypt
# Edit the four provider values in .env.development; do not paste secrets into shell history.
bun run env:encrypt
bun run dev
```

Central's first startup applies committed migrations to its existing database.
Keep this terminal running. Missing provider credentials cause startup to fail
closed. The pre-commit hook rejects plaintext staged env files and private keys;
back up `.env.keys` outside Git.

## 2. Provision the two application OIDC clients once

With Central running, use another terminal in `book-auth-middleware/`:

```sh
docker compose --env-file /dev/null exec -T auth bun run provision:bidding
docker compose --env-file /dev/null exec -T auth bun run provision:reading
```

Each command prints a one-time client ID and secret. Capture each privately:
Book Bidding and Read in Peace need **different** credentials. Each client
registers both exact HTTPS callbacks:

- Bidding sign-in: `https://bidding.localhost:8080/api/auth/callback/central-identity`
- Bidding recovery: `https://bidding.localhost:8080/api/identity-recovery/callback`
- Reading sign-in: `https://reading.localhost:8080/api/auth/callback/central-identity`
- Reading recovery: `https://reading.localhost:8080/api/identity-recovery/callback`

Provisioning rejects non-HTTPS callbacks, query/hash/userinfo, wrong paths, or
callbacks on different origins. Production provisioning requires exact
`BIDDING_RECOVERY_OIDC_REDIRECT_URI` and `READING_RECOVERY_OIDC_REDIRECT_URI`
values matching each application's recovery callback. No user can register a
client through the public HTTP API.

Before retargeting existing clients, back up the Central Identity database and
verify the dump. Retarget each existing client with its matching callback pair;
do not provision replacements, rotate client IDs/secrets, or remove volumes.
Also update operator-owned Google/GitHub registrations to the exact Central
callbacks above. If Reviewed Recovery uses separate Google/GitHub registrations,
set those registrations to their corresponding new Central callback URLs too.
External provider sign-in and recovery are not verified by this cutover.

```sh
umask 077
docker compose --env-file /dev/null exec -T db \
  sh -c 'PGPASSWORD="$POSTGRES_PASSWORD" pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom' \
  > central-before-oauth-retarget.dump
pg_restore --list central-before-oauth-retarget.dump >/dev/null
```

The dump reads its password from the database container environment; `umask 077`
keeps the backup owner-only.

This is a single-issuer cutover: old issuer and application origins are not
promised to keep working. Existing host-only sessions and emailed verification
or reset links are not portable; sign in again and request fresh links. From
`book-auth-middleware/`, set the exact new callback pair and pass it to the
running Central Identity container:

```sh
OIDC_SIGN_IN_REDIRECT_URI=https://bidding.localhost:8080/api/auth/callback/central-identity \
OIDC_RECOVERY_REDIRECT_URI=https://bidding.localhost:8080/api/identity-recovery/callback \
docker compose --env-file /dev/null exec -T \
  -e OIDC_SIGN_IN_REDIRECT_URI -e OIDC_RECOVERY_REDIRECT_URI auth \
  bun run retarget:oauth-client bidding
```

Use `reading.localhost:8080` and `reading` instead for Read in Peace.

Decrypt, edit, and re-encrypt each affected environment:

| Encrypted file | Set or check |
| --- | --- |
| Central `.env.development` | `BIDDING_OIDC_CLIENT_ID`, `READING_OIDC_CLIENT_ID` |
| Bidding `.env.development` | `CENTRAL_OIDC_CLIENT_ID`, `CENTRAL_OIDC_CLIENT_SECRET`, `CENTRAL_OIDC_ISSUER=https://auth.localhost:8080/api/auth`, app origin on `:8080` |
| Reading `backend/.env.development` | `CENTRAL_IDENTITY_CLIENT_ID`, `CENTRAL_IDENTITY_CLIENT_SECRET`, `CENTRAL_IDENTITY_ISSUER=https://auth.localhost:8080/api/auth`, public app origin on `:8080` |
| Reading `frontend/.env.development` | Public site and Central URLs on `:8080`, backend URL `http://localhost:3000`; never place secrets here |


Use `bun run env:decrypt` / `bun run env:encrypt` in Central and Bidding.
From the Reading root, use `npm run env:decrypt` / `npm run env:encrypt` to
update both packages. Their tracked `.env.development.example` files show
the remaining per-app settings. Never copy a client secret into Central's
trusted-client ID variables. After changing Central's IDs, stop its `dev`
command with Ctrl+C, then run `bun run dev` again so the auth process reloads
the trusted clients. Do not remove Compose volumes.

## 3. Trust local HTTPS and start both applications

From `book-auth-middleware/`, export Caddy's public root certificate:

```sh
docker compose --env-file /dev/null cp caddy:/data/caddy/pki/authorities/local/root.crt ./central-identity-root.crt
sudo cp central-identity-root.crt /usr/local/share/ca-certificates/central-identity-local.crt
sudo update-ca-certificates
```

Import that root certificate into the browser's trust store if it differs from
the Linux trust store (for example, Windows Chrome when Caddy runs under WSL).
Under WSL, Windows browser trust and Linux Node trust are separate. Export the
public Caddy root, copy it to a Windows-visible path, then import it into the
intended current-user Windows Root store. Never copy the private CA key.

Never export or share Caddy's private CA key. Use an **absolute** CA path for
Node processes started from the Reading subpackages.

Start each new terminal from `book-auth-middleware/`. In the Book Bidding terminal:

```sh
cd ../book-bidding
bun install --frozen-lockfile
NODE_EXTRA_CA_CERTS="$(realpath ../book-auth-middleware/central-identity-root.crt)" bun run dev
```

In a separate Read in Peace terminal:

```sh
cd ../read-in-peace
npm install
npm --prefix frontend ci
npm --prefix backend ci
NODE_EXTRA_CA_CERTS="$(realpath ../book-auth-middleware/central-identity-root.crt)" npm run dev
```

The Reading root command reuses its existing PostgreSQL Compose project.
Run schema migrations only when needed for an existing database, after a
backup. For a **new** Bidding development database only, initialize its
schema with `bun run db:push`; do not push over populated data casually.
Back up Central Identity data before migrations or other risky database
operations. From `book-auth-middleware/`:

```sh
bunx dotenvx run --strict --overload -f .env.development -- docker compose --env-file /dev/null exec -T db pg_dump -U central -d central --format=custom > central-before-migration.dump
pg_restore --list central-before-migration.dump
```

Keep `.env.keys` backed up outside Git. Back up Book Bidding and Read in Peace
databases separately using their existing operator procedures. Never use
`down -v`, reseed, or push schema over populated application data just to test
SSO.

An existing application user without a valid Identity Link must use Reviewed
Recovery; matching email is not proof of ownership. Central Identity recovery
may require separate Google/GitHub recovery client registrations and exact
callbacks. Provider consent and external OAuth behavior depend on operator
setup and are not claimed as live-tested here. Follow Central Identity's
documented reviewed recovery procedure; do not merge accounts or copy secrets
into this workflow document.

The recovery callback is registered alongside each app's regular sign-in
callback when provisioning its Central OIDC client. The two callbacks must
match the exact HTTPS origins and paths listed above. Keep each app's client
secret private in its encrypted local environment.
Do not visit the apps on `localhost:5173` or `localhost:3001` for SSO:
use their public HTTPS origins so callback URLs and cookies match.

## 4. Verify the browser flow

Use a browser that trusts Caddy's local root CA. The verified development flow
uses these entry points:

1. Open `https://bidding.localhost:8080` and select **Sign In** in the header.
   Complete credential sign-in or registration at Central Identity. Confirm
   the browser returns to `/dashboard` and `/api/auth/get-session` reports an
   authenticated Application Session.
2. In the same browser profile, open `https://reading.localhost:8080/dashboard`
   and select **Sign In** if redirected there. Confirm Central Identity reuses
   its existing SSO Session without prompting for credentials, then confirm
   Read in Peace has its own authenticated Application Session.

3. Sign out locally in one application and confirm only that Application
   Session ends. End the Central SSO Session and do not expect it to revoke
   either application's existing Application Session. A new authorization
   requires Central sign-in again.
4. Test unlinked-user recovery only through the reviewed process. A same-email
   Central Identity must not claim an existing application user's records.
   Retired local login endpoints must not establish application sessions.

5. For repeatable Book Bidding browser coverage, use a dedicated, verified
   development Central Identity. From `book-bidding/`, enter credentials
   without adding the password to shell history:

   ```sh
   read -r -p "Central Identity test email: " CENTRAL_IDENTITY_TEST_EMAIL
   read -r -s -p "Central Identity test password: " CENTRAL_IDENTITY_TEST_PASSWORD
   printf '\n'
   export CENTRAL_IDENTITY_TEST_EMAIL CENTRAL_IDENTITY_TEST_PASSWORD
   BIDDING_OIDC_TEST_ORIGIN=https://bidding.localhost:8080 \
     CENTRAL_IDENTITY_TEST_ORIGIN=https://auth.localhost:8080 \
     bun scripts/test-oidc-browser.ts
   unset CENTRAL_IDENTITY_TEST_EMAIL CENTRAL_IDENTITY_TEST_PASSWORD
   ```

   The browser test checks the protected-page return, local sign-out, and
   fresh sign-in through the still-active Central SSO Session.

The verified browser checks covered the Bidding header-to-Central-Identity
callback and dashboard return, then the Read in Peace header-to-Central flow
in the same browser context. Both `/api/auth/get-session` endpoints reported
authenticated sessions. External Google/GitHub sign-in, provider consent, and
provider-based recovery depend on operator registrations and were not
live-tested; do not treat them as passed.

Central's public HTTP integration suite covered password-reset
anti-enumeration, Mailpit link delivery, token replay rejection, password
change, and session revocation. Bidding's local legacy-login refusal and
unlinked-user ownership checks are separate from these SSO browser checks.

## 5. Run available automated checks

From `book-auth-middleware/` while its HTTPS gateway is running:

```sh
bun run typecheck
bun run test
bun run test:env
NODE_EXTRA_CA_CERTS="$(realpath central-identity-root.crt)" TEST_PROVIDER_URL=https://auth.localhost:8080 TEST_MAILPIT_URL=http://localhost:8025 bun run --filter @central-identity/server test:integration
```

From `book-bidding/`, run `bun run check && bun run test`.
From `read-in-peace/`, run `npm run test:env`,
`npm --prefix backend run test -- --runInBand`, and
`npm --prefix frontend run test`. Do not use production data for tests.

## Production later

This workflow covers local development only. Production requires a separate
deployment plan and verified domains, HTTPS, provider registrations, issuer
and callback values, secret storage, data backups and restore, migrations,
and rollback. Do not reuse development credentials or claim production
readiness from these local checks.
