# Independent local OIDC workflow

Central Identity serves `http://localhost:8080`; its OIDC issuer is
`http://localhost:8080/api/auth`. Book Bidding serves `http://localhost:5173`;
Read in Peace serves `http://localhost:3001` and proxies its own `/api/*`
requests to its backend on `http://localhost:3000`. Central Identity does not
proxy either application. Production and test-production remain HTTPS.

## Start Central Identity

Run `bun run dev` from the Central Identity checkout. It starts the ordinary
Compose stack at `http://localhost:8080`, binds the gateway to loopback, and
preserves existing named volumes. No CA, hostname, or browser trust setup is
required. Email/password sign-in is the supported local path. Google and GitHub
callbacks are deferred and unverified for this HTTP flow; do not rely on them.

Run Book Bidding in a second terminal:

```sh
cd ../book-bidding
bun run dev
```

Run Read in Peace in a third terminal:

```sh
cd ../read-in-peace
npm run dev
```

## Register callbacks

Each RP has a separate confidential OIDC client with an exact sign-in
callback and, if account recovery is used, an exact recovery callback:

| RP | Sign-in callback | Recovery callback |
| --- | --- | --- |
| Book Bidding | `http://localhost:5173/api/auth/callback/central-identity` | `http://localhost:5173/api/identity-recovery/callback` |
| Read in Peace | `http://localhost:3001/api/auth/callback/central-identity` | `http://localhost:3001/api/identity-recovery/callback` |

Existing clients can keep their client ID and secret. Retarget **only their
development callbacks** from the Central Identity checkout while the IdP
Compose stack is running:

```sh
bunx dotenvx run --strict --overload -f .env.development -fk .env.keys -- \
  docker compose --env-file /dev/null exec \
  -e OIDC_SIGN_IN_REDIRECT_URI=http://localhost:5173/api/auth/callback/central-identity \
  -e OIDC_RECOVERY_REDIRECT_URI=http://localhost:5173/api/identity-recovery/callback \
  auth bun run retarget:oauth-client bidding
bunx dotenvx run --strict --overload -f .env.development -fk .env.keys -- \
  docker compose --env-file /dev/null exec \
  -e OIDC_SIGN_IN_REDIRECT_URI=http://localhost:3001/api/auth/callback/central-identity \
  -e OIDC_RECOVERY_REDIRECT_URI=http://localhost:3001/api/identity-recovery/callback \
  auth bun run retarget:oauth-client reading
```

Retargeting requires `BIDDING_OIDC_CLIENT_ID` or `READING_OIDC_CLIENT_ID` in
Central Identity's encrypted development environment. Each value must match
the client ID configured in its RP; old local environments may hold different
IDs. Update the encrypted Central Identity value first, or pass the RP's client
ID to `docker compose exec` as `-e BIDDING_OIDC_CLIENT_ID=...` or
`-e READING_OIDC_CLIENT_ID=...` for that command. Retargeting rejects a
different or user-owned client. If no clients exist, use `provision:bidding`
and `provision:reading` instead; they print one-time secrets. Store each client
ID and secret in its **own** RP encrypted development environment, and its ID
in Central Identity's encrypted development environment. Never put client
secrets in public frontend variables or commit decrypted dotenv files.

Use the issuer from discovery,
`http://localhost:8080/api/auth`, not the portal root URL. Both RPs use
server-side code exchange, PKCE, and `client_secret_basic`. Localhost HTTP
callbacks are allowed only in local development and only when registered
exactly. Production and test-production reject HTTP callbacks. Better Auth
records development HTTP loopback clients as `native` because its `web`
registration rejects them. They still authenticate at the token endpoint with
a backend-held client secret and PKCE. Central Identity uses its own cookie
name so its HTTP SSO Session cannot collide with either RP's localhost cookies;
ports do not isolate cookies.

## Exercise the flow

Start each RP from its own checkout and follow its README for its database and
development process. Open `http://localhost:5173`, sign in with a verified
Central Identity, then open `http://localhost:3001` in the same browser profile.
Read in Peace should reuse the Central SSO Session without sharing Book
Bidding's Application Session. An existing unlinked Application User requires
Reviewed Recovery; matching email alone cannot claim it. Logout from either
application leaves the other application and Central SSO Session active.

Do not run the browser test during Central-only setup: both RPs must be running
and provisioned first. After both apps are ready, `bun run test:oidc-browser`
from Book Bidding is required to verify full Bidding-to-Reading browser SSO
before claiming issue #55 acceptance. Use `http://localhost:8025` to inspect
local verification mail. Avoid test accounts and credentials from production.
