# Independent local OIDC workflow

Central Identity serves `https://auth.localhost:8080` through its own Caddy.
Book Bidding serves `http://localhost:5173`; Read in Peace serves
`http://localhost:3001` and proxies its own `/api/*` requests to its backend
on `http://localhost:3000`. Central Identity does not proxy either application.
Production and test-production origins are separate and remain HTTPS.

## Trusted HTTPS setup

Run `bun run dev:setup` from the Central Identity checkout. It starts the
existing development Compose stack without removing volumes and exports only
the active Caddy public CA root to ignored `central-identity-root.crt`.
Repeated runs reuse the active CA file unchanged. It does not replace Caddy's
CA or modify database/client data.

The command checks that `auth.localhost` resolves to loopback. On Linux, if it
does not, the command asks before using `sudo` to add `127.0.0.1 auth.localhost`
to `/etc/hosts`. Declining prints that line for manual installation. WSL also
checks Windows DNS through PowerShell when WSL interop is available. A failed
lookup and unavailable interop are reported separately with the Windows command
to run manually. Setup never edits Windows hosts; add `127.0.0.1 auth.localhost`
there only if the Windows browser cannot resolve the name. WSL can regenerate
`/etc/hosts` on restart; rerun setup and restore the entry if resolution fails.
Do not change WSL global resolver settings for this project. Windows browsers
must reach the WSL-published loopback port.

The command asks before installing the public CA into Linux's system trust
store and the current user's Chromium certificate store. Linux system trust
requires `sudo`; Chromium trust requires `certutil` (`libnss3-tools` on
Debian/Ubuntu, `nss-tools` on Fedora). On WSL, Linux trust does not add trust to
Windows; run the printed `Import-Certificate` command in an elevated
PowerShell prompt to trust it for Windows browsers. Install `ca-certificates`
if setup reports it missing. Never approve unattended elevation, disable TLS
verification, or copy Caddy's private key.

On success, setup confirms trusted HTTPS health, OIDC discovery with the exact
HTTPS issuer, and Chromium discovery without a certificate bypass. It does not
verify Windows browser trust or full RP SSO. If trust, Linux hostname
resolution, Docker health, or Chromium is missing, it exits with the required
manual steps instead of claiming success.


Each RP development command defaults `NODE_EXTRA_CA_CERTS` to the sibling
Central Identity public root. From the Central Identity checkout, run Book
Bidding in a second terminal:

```sh
cd ../book-bidding
bun run dev
```

Run Read in Peace in a third terminal:

```sh
cd ../read-in-peace
npm run dev
```

Set `NODE_EXTRA_CA_CERTS` explicitly only when using another public CA.
Restart RP processes after CA changes.

If `POST /api/auth/sign-in/social` returns 404, check IdP discovery from the RP
host. Better Auth skips `central-identity` when discovery fails. On WSL,
`getent hosts auth.localhost` must resolve; if it does not, follow the explicit
hosts-file prompt above. Refresh the public CA with `bun run dev:setup` after
Caddy recreates its CA.

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

Do not run the browser test during Central-only setup: both RPs must be running
and provisioned first. After both apps are ready, `bun run test:oidc-browser`
from Book Bidding is required to verify full Bidding-to-Reading browser SSO
before claiming issue #55 acceptance. Use `http://localhost:8025` to inspect
local verification mail. Avoid test accounts and credentials from production.
