# Independent local OIDC workflow

Central Identity serves `https://auth.localhost:8080` through its own Caddy.
Book Bidding serves `http://localhost:5173`; Read in Peace serves
`http://localhost:3001` and proxies its own `/api/*` requests to its backend
on `http://localhost:3000`. Central Identity does not proxy either application.
Production and test-production origins are separate and remain HTTPS.

## Trust the IdP

Start Central Identity with `bun run dev`. Export its **public** local CA root
if `central-identity-root.crt` does not match the running Caddy volume:

```sh
bunx dotenvx run --strict --overload -f .env.development -fk .env.keys -- \
  docker compose --env-file /dev/null cp \
  caddy:/data/caddy/pki/authorities/local/root.crt central-identity-root.crt
```

Trust that public certificate in the browser. Add `127.0.0.1 auth.localhost`
to the resolver only if the browser or backend runtime cannot resolve it.
On WSL, check both the WSL and Windows resolvers. Set `NODE_EXTRA_CA_CERTS`
to this certificate for each Node-based RP process. Never disable TLS
verification or copy Caddy's private key.

If `POST /api/auth/sign-in/social` returns 404, check IdP discovery from the
RP host. Better Auth skips `central-identity` when discovery fails. On WSL,
`getent hosts auth.localhost` must resolve; add `127.0.0.1 auth.localhost` to
WSL's `/etc/hosts` if it does not. Refresh the public CA above whenever Caddy
recreates its CA, then restart Book Bidding from its checkout with
`NODE_EXTRA_CA_CERTS="$PWD/../book-auth-middleware/central-identity-root.crt" bun run dev`.

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
`https://auth.localhost:8080/api/auth`, not the portal root URL. Both RPs
use server-side code exchange, PKCE, and `client_secret_basic`. Localhost
HTTP callbacks are allowed only in local development and only when registered
exactly. Production rejects HTTP callbacks. Better Auth records development
HTTP loopback clients as `native` because its `web` registration rejects them.
They still authenticate at the token endpoint with a backend-held client secret
and PKCE. Different cookie names keep the two `localhost` Application Sessions
separate; ports do not isolate cookies.

## Exercise the flow

Start each RP from its own checkout with `NODE_EXTRA_CA_CERTS` pointing to the
IdP's public CA root; follow each RP README for its database and development
process. Open `http://localhost:5173`, sign in with a verified Central
Identity, then open `http://localhost:3001` in the same browser profile.
Read in Peace should reuse the Central SSO Session without sharing Book
Bidding's Application Session. An existing unlinked Application User requires
Reviewed Recovery; matching email alone cannot claim it. Logout from either
application leaves the other application and Central SSO Session active.

Use `http://localhost:8025` to inspect local verification mail. Avoid test
accounts and credentials from production. Run `bun run test:oidc-browser` from
Book Bidding with its documented test account variables for the full browser
check.
