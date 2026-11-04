# Local invited SSO browser proof

This proof uses only the local Central Identity database and disposable test
identities. Keep the existing database and volumes: do not run `down -v`, reset
or seed application databases. Use a unique `example.test` address for each
run. The provider invitation is one-time; if a run consumes it, issue a fresh
invitation to a new address.

## 1. Start the provider and provision local clients

Follow the provider's [local development setup](../README.md#local-development)
to install dependencies, trust Caddy's local root certificate, and start the
local stack. Keep `.env.keys` ignored/out of Git; committed `.env.development`
and `.env.production` contain encrypted values. Do not copy or print key
material. The public hosts are:

- Central Identity: `https://auth.127.0.0.1.nip.io`
- Book Bidding: `https://bidding.127.0.0.1.sslip.io`
- Read in Peace: `https://reading.lvh.me`
- Local-only Mailpit inbox: `http://localhost:8025`

Provision both confidential clients using the provider's documented
[Book Bidding](../README.md#book-bidding-oidc-demo) and
[Read in Peace](../README.md#read-in-peace-oidc-demo) commands. Use their exact
callbacks and local app URLs. The provisioning commands issue local client
credentials; keep each secret in that app's ignored local environment (or
encrypted `.env.development` using its local dotenvx key), and only the client
ID in the provider's encrypted `.env.development`. Do not commit, print, or
share the secrets. Restart the provider after updating its trusted client IDs.

Start both applications with their local development configuration, local
HTTPS host routing, and the provider's Caddy CA available to their runtimes.
Initialize only an empty/disposable application database if schema setup is
needed; never replace an existing local database to make the proof pass.

## 2. Invite and enroll a disposable Central Identity

Choose a fresh address such as `invite-<unique-suffix>@example.test`. In the
provider repository root, issue its invitation through the operator CLI:

```sh
bunx dotenvx run --strict --overload -f .env.development -- \
  bun run --filter @central-identity/server issue:enrollment-invitation -- \
  'invite-<unique-suffix>@example.test'
```

Open the invitation from Mailpit, create the identity at the invitation's
`/sign-up?invitation=...` link, and verify its email from the subsequent Mailpit
message. Use an ephemeral password for this disposable identity. Email
verification is required before Central Identity password sign-in.

## 3. Run the public HTTPS browser journey

Install Chromium once in the Book Bidding repository (`bunx playwright install
chromium`), then run from that repository. Use the just-invited address and
password only in the local process environment; do not add them to tracked
files or paste them into logs or chat:

```sh
NODE_EXTRA_CA_CERTS=../book-auth-middleware/central-identity-root.crt \
VITE_OIDC_INVITED_EMAIL='invite-<unique-suffix>@example.test' \
VITE_OIDC_INVITED_PASSWORD='<disposable-password>' \
bun run test:unit -- --run src/tests/oidc-invited-journey.test.ts
```

The Playwright test reads the invitation and verification links from Mailpit,
uses the public Central Identity HTTPS portal to enroll and verify, signs in
from Book Bidding's protected `/account/identity` destination, and then opens
Read in Peace's protected `/dashboard` destination in the same browser context.
It asserts the original protected destinations, absence of a second central
password prompt, and distinct Application Users and Application Sessions.

The existing public browser scenarios remain part of the regression proof:

```sh
NODE_EXTRA_CA_CERTS=../book-auth-middleware/central-identity-root.crt \
VITE_OIDC_TEST_EMAIL='<verified-disposable-email>' \
VITE_OIDC_TEST_PASSWORD='<disposable-password>' \
bun run test:unit -- --run src/tests/oidc-cross-app.test.ts

VITE_OIDC_CONFLICT_EMAIL='<email shared by a disposable legacy Bidding user and Central Identity>' \
VITE_OIDC_CONFLICT_PASSWORD='<Central Identity password>' \
VITE_OIDC_LOCAL_PASSWORD='<legacy Bidding password>' \
bun run test:unit -- --run src/tests/oidc-email-collision.test.ts

NODE_EXTRA_CA_CERTS=../book-auth-middleware/central-identity-root.crt \
VITE_OIDC_LINK_LOCAL_EMAIL='<disposable legacy Bidding email>' \
VITE_OIDC_LINK_LOCAL_PASSWORD='<legacy Bidding password>' \
VITE_OIDC_LINK_CENTRAL_EMAIL='<different verified Central Identity email>' \
VITE_OIDC_LINK_CENTRAL_PASSWORD='<Central Identity password>' \
bun run test:unit -- --run src/tests/oidc-identity-link.test.ts
```

These existing public flows cover protected-return handling and hostile
cross-origin return targets, legacy password login, same-email collision
refusal, proof-of-both-accounts linking and conflicting-link refusal, and
independent app and central sign-outs. The applications retain their
Application Sessions when the Central SSO Session ends; a new authorization
requires fresh Central Identity credentials.
