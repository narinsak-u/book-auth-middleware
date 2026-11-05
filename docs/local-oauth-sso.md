# Development SSO workflow

Run these commands from three sibling repositories: `book-auth-middleware/`,
`book-bidding/`, and `read-in-peace/`. This workflow is for development.
Live production still uses its existing invitation/password flow. Preserve
existing databases and Compose volumes; never run `down -v` or reseed them
just to test SSO.

## How sign-in works

1. Book Bidding or Read in Peace redirects the browser to Central Identity's
   OIDC issuer at `https://auth.127.0.0.1.nip.io:8080/api/auth`.
2. Central signs the person in through Google or GitHub. The provider must
   supply a verified email. A first provider sign-in creates a Central Identity
   and its host-only Central SSO Session; no invitation or Central password is
   needed. Matching email alone never links another provider account.
3. Central returns an authorization code to the requesting application's
   registered callback. The application exchanges the code, checks the issuer
   and subject, then uses its own Application User and Application Session.
   Matching email alone does not claim an existing application user either.
4. The browser can use its Central SSO Session for the other application without
   another provider prompt. Central sign-out ends only the Central session;
   each application session survives until that application ends it or it expires.

| Service | Development process | Public HTTPS origin |
| --- | --- | --- |
| Central Identity | Auth and portal in Compose | `https://auth.127.0.0.1.nip.io:8080` |
| Book Bidding | SvelteKit on `:5173` | `https://bidding.127.0.0.1.sslip.io:8080` |
| Read in Peace | Nest on `:3000`, Nuxt on `:3001` | `https://reading.lvh.me:8080` |

Caddy provides all three public origins on `:8080`. Its Central auth and portal
processes use separate container-internal ports. On WSL, Central's `dev` script
finds the host address for Caddy's sibling-app proxies; install `iproute2` and
`jq` if missing.

## 1. Register external providers and configure Central

Create **development-only** Google and GitHub OAuth registrations. Configure
their exact authorized callback URLs:

- Google: `https://auth.127.0.0.1.nip.io:8080/api/auth/callback/google`
- GitHub: `https://auth.127.0.0.1.nip.io:8080/api/auth/callback/github`

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
Book Bidding and Read in Peace need **different** credentials. The registered
callbacks are respectively
`https://bidding.127.0.0.1.sslip.io:8080/api/auth/callback/central-identity`
and `https://reading.lvh.me:8080/api/auth/callback/central-identity`. Skip
provisioning on later boots if the existing registrations already use those
exact callbacks; otherwise provision replacements rather than resetting a
database. No user can register a client through the public HTTP API.

Decrypt, edit, and re-encrypt each affected environment:

| Encrypted file | Set or check |
| --- | --- |
| Central `.env.development` | `BIDDING_OIDC_CLIENT_ID`, `READING_OIDC_CLIENT_ID` |
| Bidding `.env.development` | `CENTRAL_OIDC_CLIENT_ID`, `CENTRAL_OIDC_CLIENT_SECRET`, `CENTRAL_OIDC_ISSUER=https://auth.127.0.0.1.nip.io:8080/api/auth`, app origin on `:8080` |
| Reading `backend/.env.development` | `CENTRAL_IDENTITY_CLIENT_ID`, `CENTRAL_IDENTITY_CLIENT_SECRET`, `CENTRAL_IDENTITY_ISSUER=https://auth.127.0.0.1.nip.io:8080/api/auth`, public app origin on `:8080` |
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
Do not visit the apps on `localhost:5173` or `localhost:3001` for SSO:
use their public HTTPS origins so callback URLs and cookies match.

## 4. Test the browser flow

Use a fresh browser profile and test identities you control:

1. Open `https://bidding.127.0.0.1.sslip.io:8080/dashboard`. Choose
   **Continue with Central Identity** at sign-in, then Google or GitHub
   at Central. Complete the real provider consent. Confirm the browser
   returns to Book Bidding and `/api/auth/get-session` on its host reports
   an Application Session.
2. Open `https://reading.lvh.me:8080/dashboard` in the **same browser profile**.
   Choose **Continue with Central Identity**. Confirm the protected Reading
   destination opens without a second Google/GitHub prompt. Its session is
   separate from Bidding's.
3. In a separate clean browser profile, try the *other* provider with the
   same verified email as an existing Central Identity. It must not claim
   that identity by email. Return to the original still-signed-in profile,
   use **Link Google** or **Link GitHub** in Central's portal, then repeat
   sign-in through that provider. Explicit linking can also use a different
   verified email.
4. Sign out from Central's portal in the original profile. Reload both
   applications: their sessions must remain. Sign out from one application:
   the other must remain signed in. A fresh Central authorization must show
   Central sign-in; Google/GitHub may still retain their own sessions.
5. To protect an existing application user, sign in **locally** first. Use
   Book Bidding's **Identity Link** or Read in Peace's **Central Identity
   link** action. Without that action, a same-email Central login must not
   claim the existing application user or its data. Each app's local
   password login remains available.

Central's development `/api/auth/sign-up/email`, `/api/auth/sign-in/email`,
and password-reset endpoints return HTTP `410`; `/sign-up` redirects to
OAuth sign-in. Existing Central password-only identities can link a provider
from an unexpired Central session. Otherwise an operator uses reviewed
recovery, not a public password or recovery form. See the exact private
CLI command and provider-token precautions in the
[Central README](../README.md#reviewed-recovery). Never run recovery on a
real person's identity merely to exercise this workflow.

## 5. Run available automated checks

From `book-auth-middleware/` while its HTTPS gateway is running:

```sh
bun run typecheck
bun run test
bun run test:env
NODE_EXTRA_CA_CERTS="$(realpath central-identity-root.crt)" TEST_PROVIDER_URL=https://auth.127.0.0.1.nip.io:8080 bun run --filter @central-identity/server test:integration
```

The public HTTP suite checks retired endpoints, readiness, and discovery.
The provider-proof tests check verified email handling for operator recovery.
Neither substitutes for the real Google/GitHub callback browser test above.

From `book-bidding/`, run `bun run check && bun run test`.
From `read-in-peace/`, run `npm run test:env`,
`npm --prefix backend run test -- --runInBand`, and
`npm --prefix frontend run test`. Do not use production data for tests.

## Test-production later

`dev:prod` is an isolated **local production-mode test**, not live production.
Configure each repo's `.env.test-production.example` with separate Google,
GitHub, OIDC client, database, and application secrets; encrypt the selected
files with that repo's `env:encrypt:test-production` command (Reading uses
`ENV_FILE=.env.test-production npm run env:encrypt`). Central uses a separate
Compose project, Caddy CA, PostgreSQL volume, and gateway `:8081`; Bidding
previews on `:5174`; Reading uses backend `:3100`, frontend `:3101`, and
database `:5433`. Register test-prefixed provider and application callbacks
before attempting a browser sign-in. Never load `.env.production` or reuse
development credentials for this mode.

Start each repo's `dev:prod` from its own root after its test credentials are
configured. Export the test gateway's **different** CA from Central:

```sh
bunx dotenvx run --strict -f .env.test-production -fk .env.test-production.keys -- docker compose --env-file /dev/null --project-name central-test-production -f compose.yaml -f compose.test-production.yaml cp caddy:/data/caddy/pki/authorities/local/root.crt ./central-test-production-root.crt
```

Trust that CA in the browser. Set `NODE_EXTRA_CA_CERTS` to its absolute path
when starting the test-production app processes. Repeat the same browser
checks against `auth-test.127.0.0.1.nip.io:8081`,
`bidding-test.127.0.0.1.sslip.io:8081`, and
`reading-test.lvh.me:8081`. Live production remains unchanged.
