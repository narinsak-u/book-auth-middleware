# Local SSO Development: Current Status

**Status:** Local HTTP SSO is implemented. This document records current behavior, verification, and remaining limitations; it is not a proposed migration plan.

## Local architecture

| Service | Development origin |
| --- | --- |
| Central Identity | `http://localhost:8080` |
| Book Bidding | `http://localhost:5173` |
| Read in Peace frontend | `http://localhost:3001` |
| Read in Peace backend | `http://localhost:3000` |
| Mailpit | `http://localhost:8025` |

Central Identity owns the OIDC provider and its SSO session. Each relying party (RP) owns its application users, data, and session. Read in Peace proxies browser API requests to its own backend. Central Identity's gateway serves only Central Identity.

The local issuer is `http://localhost:8080/api/auth`. The RPs use Authorization Code Flow, PKCE, server-side confidential-client code exchange, and their own application sessions.

## Implemented

- Central Identity runs on HTTP loopback for ordinary local development. No custom DNS entry, local CA trust, or TLS bypass is required.
- Book Bidding and Read in Peace use separate OIDC clients and exact sign-in callbacks. Optional recovery flows use separate callbacks.
- The browser integration test in `book-bidding/scripts/test-oidc-browser.ts` checks credential sign-in, SSO reuse, independent RP sessions, cookie separation, destination restoration, and sign-out boundaries.
- Localhost cookie names are distinct. Ports do not isolate localhost cookies.
- Test-production remains isolated on HTTPS with separate origins, credentials, callbacks, databases, and CA trust. Production remains HTTPS.
- Local databases and existing identities are preserved. Do not reset database volumes to run SSO tests.

## Run local SSO

Use each repository's encrypted development environment and private dotenvx keys. Do not use production credentials.

Start Central Identity's database and Mailpit, then its API and portal:

```sh
cd book-auth-middleware
bunx dotenvx run --strict --overload -f .env.development -fk .env.keys -- \
  docker compose --env-file /dev/null -f compose.yaml -f compose.bun.yaml up -d --wait db mailpit
bun run dev
```

Start each RP in a separate terminal:

```sh
cd book-bidding
bun run dev
```

```sh
cd read-in-peace
npm run dev
```

Provision or retarget each development OIDC client using `docs/local-oauth-sso.md`. Keep each client secret in its RP's encrypted backend environment. Register the exact sign-in callback and, only when testing recovery, its exact recovery callback.

Set `CENTRAL_IDENTITY_TEST_EMAIL` and `CENTRAL_IDENTITY_TEST_PASSWORD` to a dedicated verified local Central Identity account, then run:

```sh
cd book-bidding
bun run test:oidc-browser
```

The test uses the local origins above by default. It requires all three applications running, provisioned clients, and a verified test account. Inspect local verification email at `http://localhost:8025`.

## Remaining limitations

- Google and GitHub callbacks remain deferred and unverified for the local HTTP flow. Do not rely on them for local sign-in or recovery.
- Test-production hostname resolution may require loopback mappings in WSL and Windows. Its isolated HTTPS flow also requires trusting the matching Caddy CA in the browser and Node.js.
- This checkout's existing Read in Peace database volume contains PostgreSQL 16 data, while `backend/docker-compose.yml` requests PostgreSQL 17.5. Do not delete or upgrade that volume to run this test; verification uses a separate temporary PostgreSQL 16 volume.
- Production readiness is not established by local or synthetic tests. Operators must verify DNS, trusted TLS, database backup and restore, SMTP, Vercel runtime settings, exact production callbacks, and real-account browser SSO.
- Do not change production issuer settings, weaken OIDC validation, expose local services, or delete database volumes to make local development work.

## Verification record

The local Bidding-to-Reading browser SSO test passed on 2026-11-19 with `bun run test:oidc-browser` and a dedicated verified local identity. It established Bidding's application session, preserved Central SSO through Bidding sign-out and reauthorization, created an independent Reading session without another credential prompt, and verified Reading sign-out isolation.