# Book Auth — Local Development & Reverse Proxy Specification

**Version:** 1.1  
**Status:** Proposed  
**Scope:** Caddy, HTTPS, local development, and OIDC connectivity  
**Repositories:** `book-auth-middleware`, `book-bidding`, `read-in-peace`

This is a proposed cutover, not the current development setup. The existing Caddy gateway already proxies all three applications. Current runbooks describe the working `nip.io`, `sslip.io`, and `lvh.me` origins until the coordinated cutover is verified.

---

## 1. Overview

### 1.1 Purpose

Improve the local development infrastructure for the Book Auth SSO ecosystem.

The system consists of three independent repositories:

1. `book-auth-middleware` — Central Identity Provider (IdP)
2. `book-bidding` — OIDC Relying Party
3. `read-in-peace` — OIDC Relying Party

The infrastructure must provide stable local URLs and HTTPS connectivity for testing OpenID Connect authentication flows.

### 1.2 Objectives

- Keep all three repositories independent.
- Simplify local domain configuration.
- Provide a consistent HTTPS development environment.
- Use Caddy as a reverse proxy, not an authentication service.
- Ensure OIDC callbacks work correctly.
- Prevent cross-application cookie conflicts.
- Make local SSO behavior similar to production.
- Avoid unnecessary coupling between application deployments.

### 1.3 Non-Goals

- Creating an API gateway for all business services.
- Merging repositories into one monorepo.
- Sharing authentication cookies between applications.
- Implementing OAuth/OIDC logic inside Caddy.
- Using Caddy for user authorization.
- Making local development services publicly accessible.

---

## 2. Architecture Decision

### 2.1 Repository Independence

Each repository remains independent.

```text
book-auth-middleware/
├── apps/
│   ├── web/           # TanStack Start
│   └── server/        # Elysia + Better Auth
├── packages/
│   └── db/            # Drizzle + PostgreSQL
└── infrastructure/

book-bidding/
├── frontend/
└── backend/

read-in-peace/
├── frontend/
└── backend/
```

The exact internal structures of `book-bidding` and `read-in-peace` should be preserved based on their existing implementations.

Do not assume either application uses a particular framework or directory layout without inspecting its repository.

### 2.2 Authentication Responsibilities

**book-auth-middleware**

- Authentication UI
- Google and GitHub login
- Username/email/password login
- Password recovery
- Central SSO session
- OIDC authorization
- Token issuance

**book-bidding and read-in-peace**

- Initiate OIDC login.
- Handle OIDC callbacks.
- Validate identity.
- Create local application sessions.
- Enforce application permissions.
- Redirect users to their original requested pages.

**Caddy**

- Terminate HTTPS.
- Route incoming traffic to the correct application.
- Forward HTTP requests and responses.
- Support development connections such as WebSocket upgrades.

Caddy must not perform application authentication.

---

## 3. Local Domain Strategy

### 3.1 Target hostnames

Use `.localhost` for both isolated local stacks. Keep their ports, databases, client registrations, and Caddy CA stores separate:

| Service | Development | Test-production |
|---|---|---|
| Identity Provider | `https://auth.localhost:8080` | `https://auth-test.localhost:8081` |
| Book Bidding | `https://bidding.localhost:8080` | `https://bidding-test.localhost:8081` |
| Read in Peace | `https://reading.localhost:8080` | `https://reading-test.localhost:8081` |

All six hostnames must resolve to the local loopback interface. Do not change public production domains.

### 3.2 Why `.localhost`?

Benefits:

- Designed for local development.
- Does not depend on external wildcard DNS services.
- Supports readable application-specific hostnames.
- Provides distinct hostnames for cookies.
- Works with Caddy's local HTTPS certificates.
- Reduces configuration complexity.

Use host-only cookies for each application.

Do not configure a shared cookie domain such as `.localhost`.

### 3.3 Hostname Resolution

Verify that the development operating system resolves the required hostnames to loopback addresses.

If its DNS resolver does not support the desired subdomains, configure local hostname mappings.

Example hosts entries:

```text
127.0.0.1 auth.localhost
127.0.0.1 bidding.localhost
127.0.0.1 reading.localhost
127.0.0.1 auth-test.localhost
127.0.0.1 bidding-test.localhost
127.0.0.1 reading-test.localhost
```

Do not assume all operating systems, browsers, containers, and development runtimes resolve custom local hostnames identically.

Validate resolution in each environment used for testing.

---

## 4. Recommended Development Architecture

Use a shared HTTPS gateway for end-to-end SSO testing.

```text
                       Browser
                          |
                          v
               Local HTTPS :8080
                          |
                          v
                         Caddy
                          |
            +-------------+-------------+
            |             |             |
            v             v             v
       auth.localhost  bidding.localhost  reading.localhost
            |             |             |
       +----+----+        |             |
       |         |        |             |
       v         v        v             v
    TanStack   Elysia   Bidding       Reading
     Start     Auth      Dev           Dev
      Web      API      Server        Server
       |         |
       |         v
       |     Better Auth
       |         |
       |         v
       |     PostgreSQL
       |
       +-- Login Portal
```

### 4.1 Important Principle

The shared gateway is a **development convenience**, not a required component of the SSO architecture.

Each application must still be capable of running and deploying independently.

In production, applications may use separate reverse proxies, hosting providers, domains, and infrastructure.

---

## 5. Caddyfile Specification

### 5.1 Recommended Configuration

```caddyfile
{
    auto_https disable_redirects
}

# Central Identity Provider, replacing the existing development host
https://auth.localhost:8080 {
    tls internal
    @backend path /api/auth /api/auth/* /.well-known/* /oauth2/* /health /health/*
    handle @backend {
        reverse_proxy auth:3000
    }
    handle {
        reverse_proxy web:3001
    }
}

# Book Bidding
https://bidding.localhost:8080 {
    tls internal
    reverse_proxy host.docker.internal:5173
}

# Read in Peace
https://reading.localhost:8080 {
    tls internal
    reverse_proxy host.docker.internal:3001
}
```

Apply the same route matcher to the existing isolated test-production Caddyfile. Use `auth-test.localhost:8081`, `bidding-test.localhost:8081`, and `reading-test.localhost:8081`, with host upstream ports `5174` and `3101`. Do not start a second gateway on port `8080`.

### 5.2 Required Routing Behavior

**Central IdP**

| Request | Upstream |
|---|---|
| `/sign-in` | TanStack Start |
| `/sign-up` | TanStack Start |
| `/forgot-password` | TanStack Start |
| `/reset-password` | TanStack Start |
| `/api/auth` and `/api/auth/*` | Elysia |
| `/.well-known/*` | Elysia |
| `/oauth2/*` | Elysia |
| `/health` and `/health/*` | Elysia |

Better Auth configures `/oauth/consent` as its consent page, but the portal does not implement that route. The two existing trusted clients skip consent. Do not claim consent UI works or add it as part of this proxy-only change.

OIDC discovery paths under `/api/auth/.well-known/*` must also reach Elysia.

Keep the existing `/oauth2/*` and metadata routes on Elysia. Match any further endpoints actually advertised by the installed Better Auth provider; add custom backend routes explicitly.

**Book Bidding**

All incoming requests are forwarded to its configured development application entry point.

**Read in Peace**

All incoming requests are forwarded to its configured development application entry point.

### 5.3 Proxy Rules

- Preserve original request paths.
- Preserve the external Host header.
- Forward WebSocket upgrades.
- Avoid unnecessary upstream connection limits.
- Do not rewrite OIDC callback paths.
- Do not implement authentication checks in Caddy.
- Do not forward IdP routes to the frontend when they belong to Better Auth.
- Avoid exposing development-only admin or diagnostic endpoints publicly.

### 5.4 Environment Compatibility

The example assumes:

- Caddy runs in Docker.
- IdP frontend and backend run in Docker.
- Bidding and Reading development servers run on the host.

If a service runs in Docker, use its service name on the shared Docker network.

If a service runs on the host, use a reachable host address.

Do not hardcode the upstream assumption without verifying the actual development setup.

---

## 6. Docker Compose Requirements

### 6.1 Existing Caddy service

Update the existing `compose.yaml` service rather than adding another Caddy service or network. Preserve its loopback-only port binding, Docker host-gateway mapping (including the `DEV_HOST_IP` override used on WSL), existing `auth` and `web` dependencies, and persistent `caddy-data` and `caddy-config` volumes:

```yaml
caddy:
  ports:
    - "127.0.0.1:8080:8080"
  volumes:
    - ./infrastructure/Caddyfile:/etc/caddy/Caddyfile:ro
    - caddy-data:/data
    - caddy-config:/config
  extra_hosts:
    - "host.docker.internal:${DEV_HOST_IP:-host-gateway}"
```

Retain the existing test-production Compose overlay: it publishes `127.0.0.1:8081` and mounts `infrastructure/Caddyfile.test-production`. Its separate Compose project must retain separate database and Caddy CA volumes.

### 6.2 Host-Based Development Servers

When Caddy runs in Docker and proxies to host-based applications:

- Ensure the applications listen on a network interface reachable from Docker.
- Confirm `host.docker.internal` resolves inside Caddy.
- Do not assume a process listening only on `127.0.0.1` is reachable from a Linux Docker container.
- Keep development services protected from unintended network exposure.

Book Bidding's existing `bun run dev` binds Vite to `0.0.0.0:5173`. Reading's Nuxt development server binds to `0.0.0.0:3001`; the backend runs separately on host port `3000`. Verify that Docker can reach each upstream without exposing either dev server to untrusted networks.

Restrict external access using firewall rules and local network configuration.

### 6.3 Port Isolation

Caddy is the public entry point for local HTTPS.

Internal services may retain their existing ports:

```text
Caddy:
  8080

IdP Backend:
  3000

IdP Frontend:
  3001

Book Bidding:
  5173

Read in Peace:
  3001
```

Port reuse is valid when services run in different network namespaces.

If two applications bind to the same host network namespace, they cannot listen on the same interface and port simultaneously.

---

## 7. HTTPS and Certificate Trust

### 7.1 Local TLS

Use:

```caddyfile
tls internal
```

Caddy generates locally trusted certificates through its internal certificate authority.

Since Caddy may run inside Docker, the host system and development runtimes may not automatically trust this authority.

### 7.2 Certificate Requirements

- Persist Caddy's certificate authority data.
- Trust the development CA in the host OS/browser as appropriate.
- Configure server-side OIDC clients to trust the same CA.
- Keep TLS verification enabled.
- Do not use insecure TLS bypasses.

The two Compose projects have separate Caddy CA stores. Export and trust each root for its own stack. Supply the appropriate absolute certificate path through `NODE_EXTRA_CA_CERTS` to the host-based Bidding and Reading runtimes. Import the root into the browser trust store when it differs from the host OS store.

### 7.3 Certificate Export

Example:

```bash
docker compose cp \
  caddy:/data/caddy/pki/authorities/local/root.crt \
  ./caddy-root.crt
```

For test-production, export from its separate `central-test-production` Compose project and use a different filename. Never export a private CA key or disable TLS verification to make a browser check pass.

Install the certificate using the trusted root certificate management mechanism supported by the development OS.

For containerized applications, include or mount the CA certificate through an appropriate development-only mechanism.

Avoid shipping development CA certificates in production images.

---

## 8. OIDC Configuration

### 8.1 Central issuer

Set `AUTH_DOMAIN=auth.localhost:8080` and `BETTER_AUTH_URL=https://auth.localhost:8080` in development. Set `AUTH_DOMAIN=auth-test.localhost:8081` and `BETTER_AUTH_URL=https://auth-test.localhost:8081` in test-production. Keep production configuration unchanged.

Verify the effective `issuer` from Better Auth discovery. With the existing `/api/auth` base path, the target issuers are `https://auth.localhost:8080/api/auth` and `https://auth-test.localhost:8081/api/auth`.

### 8.2 Book Bidding configuration

Set `PUBLIC_BASE_URL`, `PUBLIC_FRONTEND_URL`, and `BETTER_AUTH_URL` to `https://bidding.localhost:8080`. Set `PUBLIC_CENTRAL_IDENTITY_URL` to `https://auth.localhost:8080` and `CENTRAL_OIDC_ISSUER` to `https://auth.localhost:8080/api/auth`. Update `BIDDING_RECOVERY_OIDC_REDIRECT_URI` if configured. Keep the encrypted `CENTRAL_OIDC_CLIENT_ID` and `CENTRAL_OIDC_CLIENT_SECRET` unchanged.

Register these exact callbacks for the existing Bidding client:

```text
https://bidding.localhost:8080/api/auth/callback/central-identity
https://bidding.localhost:8080/api/identity-recovery/callback
```

### 8.3 Read in Peace configuration

Set backend `BETTER_AUTH_URL`, `FRONTEND_URL`, and `CORS_ORIGINS` to `https://reading.localhost:8080`; set `CENTRAL_IDENTITY_ISSUER` to `https://auth.localhost:8080/api/auth`. Update `READING_RECOVERY_OIDC_REDIRECT_URI` and `READING_RECOVERY_PROVIDER_REDIRECT_URI`. Set frontend `NUXT_PUBLIC_SITE_URL` to `https://reading.localhost:8080`; keep `NUXT_PUBLIC_BACKEND_URL=http://localhost:3000`. Keep the encrypted `CENTRAL_IDENTITY_CLIENT_ID` and `CENTRAL_IDENTITY_CLIENT_SECRET` unchanged.

Register these exact callbacks for the existing Reading client:

```text
https://reading.localhost:8080/api/auth/callback/central-identity
https://reading.localhost:8080/api/identity-recovery/callback
```

### 8.4 Isolated test-production clients

Use the corresponding `*-test.localhost:8081` origins, the `auth-test.localhost:8081/api/auth` issuer, and the same callback paths for the separate test-production clients. Keep the existing host upstream ports: Bidding `5174`, Reading Nuxt `3101`, and Reading Nest `3100`. Update each repository's separate encrypted test-production environment and example files. Never copy development IDs, secrets, databases, or CA trust settings into test-production.

### 8.5 Registration and cutover

Back up existing local databases before changing client registrations. Update each existing client's two registered redirect URIs in place through an operator-only procedure; retain its client ID, secret, PKCE requirement, and `client_secret_basic` setting. Validate the exact HTTPS sign-in and recovery paths and common application origin. Do not create a public client-management endpoint, reprovision clients, reset databases, or rotate secrets.

Coordinate the gateway, both apps, each stack's issuer, and its registrations as one cutover. Host-only cookies on the old origins cannot authenticate on `.localhost`; users must sign in again. Old verification and reset links also target the old hosts; request fresh links. Do not claim seamless sessions or dual-issuer support.

Update operator-owned Google and GitHub callback registrations separately for Central Identity (`/api/auth/callback/google` and `/api/auth/callback/github`) and each application's recovery-provider callback (`/api/identity-recovery/provider/callback`). Document the new origins for both stacks. Credential-based OIDC checks do not verify these social or recovery flows.

### 8.6 Redirect requirements

- Use registered callback URLs.
- Use Authorization Code Flow with PKCE.
- Validate OAuth state.
- Validate OIDC nonce.
- Validate ID Token signatures and claims.
- Restore the original application destination after successful callback validation.
- Never redirect to arbitrary user-supplied URLs.
- Never pass tokens through untrusted redirect query parameters.

---

## 9. SSO Authentication Flow

### 9.1 Initial Login

```text
User visits bidding.localhost:8080
              |
              v
      No local session
              |
              v
      Start OIDC flow
              |
              v
       auth.localhost:8080
              |
              v
         Login Portal
              |
              v
         Better Auth
              |
              v
       Central SSO Session
              |
              v
       OIDC Authorization
              |
              v
    bidding.localhost Callback
              |
              v
     Create local session
              |
              v
      Original requested page
```

### 9.2 SSO Reuse

```text
User visits reading.localhost:8080
              |
              v
      No local session
              |
              v
      Start OIDC flow
              |
              v
       auth.localhost:8080
              |
              v
    Existing central session
              |
              v
       Skip login form
              |
              v
       OIDC Authorization
              |
              v
    reading.localhost Callback
              |
              v
      Create local session
              |
              v
      Original requested page
```

### 9.3 Session Separation

Each application must maintain its own host-only session cookie.

Example:

```text
auth.localhost
  Central SSO session

bidding.localhost
  Bidding application session

reading.localhost
  Reading application session
```

Do not reuse the same session cookie across all applications.

Do not rely on cross-domain cookie sharing to implement SSO.

---

## 10. Alternative: Independent Local Development

Developers may run each repository independently without using the shared gateway.

Example:

```text
IdP:
https://auth.localhost:8080

Bidding:
http://localhost:5173

Reading:
http://localhost:3001
```

HTTP `localhost` ports may be used for isolated application work without OIDC. The existing client registration validator requires exact HTTPS callbacks for sign-in and recovery; do not register `http://localhost` callbacks or weaken that rule. `localhost` cookies are not isolated by port.

For SSO and callback testing, run the existing shared HTTPS gateway and use the application-specific `.localhost` origins. Production applications must not depend on this local gateway.

---

## 11. Validation and Testing

### 11.1 Caddy Configuration

Validate the configuration before starting or reloading Caddy:

```bash
docker compose exec caddy \
  caddy validate --config /etc/caddy/Caddyfile
```

### 11.2 Domain Resolution

Check all six hosts in the browser environment and host runtime, not only inside Docker:

```bash
getent hosts auth.localhost
getent hosts bidding.localhost
getent hosts reading.localhost
getent hosts auth-test.localhost
getent hosts bidding-test.localhost
getent hosts reading-test.localhost
```

Use the operating system's equivalent DNS or hostname-resolution utility where necessary.

### 11.3 HTTPS Validation

Test:

```bash
curl --cacert ./caddy-root.crt \
  https://auth.localhost:8080/sign-in
```

Repeat for both relying-party origins.

Check the three `:8081` origins with their separate test-production CA root. Loopback mappings may need entries in both WSL and Windows when the browser runs on Windows.

Do not use `curl -k` as a permanent solution for certificate validation.

### 11.4 OIDC Discovery

For the expected default issuer path:

```bash
curl --cacert ./caddy-root.crt \
  https://auth.localhost:8080/api/auth/.well-known/openid-configuration
```

Verify:

- Correct `issuer`.
- Valid authorization endpoint.
- Valid token endpoint.
- Valid JWKS URI.
- Correct HTTPS scheme.
- Correct hostname and port.

If the discovery endpoint fails, verify both Caddy routing and Elysia's Better Auth handler registration.

A reverse proxy matcher cannot create a protocol endpoint that the backend does not implement.

Repeat discovery for `https://auth-test.localhost:8081/api/auth/.well-known/openid-configuration` using that stack's CA root. Verify its issuer is `https://auth-test.localhost:8081/api/auth`, not the development issuer. Check the actual registered sign-in and recovery callbacks for each stack.

### 11.5 End-to-End SSO Tests

**Test A — Initial Login**

1. Open Book Bidding.
2. Click Sign In.
3. Confirm redirect to the IdP.
4. Authenticate.
5. Confirm callback to Book Bidding.
6. Confirm local session establishment.
7. Confirm restoration of the original requested page.

**Test B — Session Reuse**

1. Complete Test A.
2. Open Read in Peace.
3. Initiate OIDC authentication.
4. Confirm the IdP recognizes the existing SSO session.
5. Confirm no additional login form is displayed.
6. Confirm callback to Read in Peace.
7. Confirm a separate local session is created.

**Test C — Cookie Isolation**

Verify that:

- The IdP session cookie is scoped to `auth.localhost`.
- Book Bidding uses its own session cookie.
- Read in Peace uses its own session cookie.
- A local application session is not accepted by another application.

**Test D — Callback Security**

Reject:

- Invalid state.
- Invalid nonce.
- Invalid redirect URI.
- Invalid issuer.
- Incorrect token audience.
- Expired ID Token.
- Reused authorization code.

**Test E — Certificate Trust**

Verify that:

- Browser redirects complete over HTTPS.
- Backend token exchange succeeds.
- OIDC metadata and JWKS can be fetched.
- No TLS verification bypass is required.

Update `book-bidding/scripts/test-oidc-browser.ts` to use a trusted browser CA before treating its results as acceptance evidence. Its current `ignoreHTTPSErrors: true`, `curl -k`, and equivalent bypasses do not prove TLS trust. Prior checks against old origins do not prove this cutover.

For test-production, require host routing, HTTPS certificate trust, IdP portal and backend routing, discovery metadata, and exact client callback registrations. Full two-application browser SSO is required for development only; do not claim it passed on test-production without exercising it.

---

## 12. Implementation Tasks

### Phase 1 — Local domain standardization

- Replace mixed local hostnames in both development and isolated test-production with `.localhost`.
- Validate all six hostnames from each client environment; document host mappings where resolution fails.
- Update encrypted local environments and examples, Caddyfiles, runtime origin defaults, provisioning defaults, and exact host guards without touching public production domains.
- Update Bidding's Vite allowed hosts and Reading's Nuxt allowed hosts and hardcoded development and test-production commands.
- Preserve each stack's existing clients and credentials while replacing both registered callbacks per client.
- Coordinate issuer changes with the apps; expect fresh sessions and fresh emailed links.

### Phase 2 — Caddy Simplification

- Update the existing Caddy gateway's host routes and backend matcher; do not add another gateway.
- Preserve Better Auth discovery, `/oauth2/*`, and health routes. Do not add consent UI to this infrastructure change.
- Remove unnecessary connection limits.
- Validate host-to-container networking.
- Ensure OIDC discovery paths reach Elysia.

### Phase 3 — HTTPS Trust

- Persist Caddy CA data.
- Export the root certificate.
- Configure host trust.
- Configure backend runtime trust.
- Verify TLS connections without insecure bypasses.

### Phase 4 — OIDC Validation

- Verify both stacks' Better Auth discovery metadata and exact client registrations.
- Test development initial login, SSO reuse, original destinations, and cookie isolation through both real applications.
- Test test-production HTTPS routing, discovery, issuer, and callback registrations without claiming full browser SSO.
- Document separate operator work for Central and recovery Google/GitHub callbacks.

### Phase 5 — Documentation

Document:

- Local development architecture.
- Domain and port mappings.
- Caddy responsibilities.
- How to start each repository.
- HTTPS certificate setup.
- OIDC configuration.
- Troubleshooting steps.
- Production differences.

---

## 13. Acceptance Criteria

- [ ] All three repositories remain independent.
- [ ] Turborepo remains internal to `book-auth-middleware`.
- [ ] All six `.localhost` hostnames resolve in the required host and browser environments.
- [ ] The existing Caddy gateway serves three development origins on `:8080` and three isolated test-production origins on `:8081` over trusted HTTPS.
- [ ] Frontend requests reach TanStack Start; Better Auth discovery, `/oauth2/*`, and health requests reach Elysia on both stacks.
- [ ] Each stack advertises its own exact HTTPS issuer and routes its own registered sign-in and recovery callbacks.
- [ ] Existing OIDC client IDs and secrets, databases, and application deployments remain intact.
- [ ] The development browser flow creates a Central SSO Session and separate Application Sessions in both apps, reuses the Central session, isolates cookies, and restores each original page.
- [ ] Development browser and backend OIDC requests use trusted CA roots without TLS verification bypasses.
- [ ] Test-production HTTPS routing and discovery work with its separate CA; full browser SSO is not claimed without a live check.
- [ ] Google/GitHub and recovery-provider callback changes are documented as operator tasks, not claimed as verified sign-ins.
- [ ] Public production URLs, databases, and deployments remain independent of the local gateway.

---

## 14. AI Coding Agent Instructions

Implement this specification as an infrastructure refinement, not an authentication redesign.

### Rules

1. Inspect the existing Caddyfile and Docker Compose setup before modifying them.
2. Preserve working Elysia and Better Auth endpoints.
3. Do not rewrite authentication logic.
4. Do not modify database schemas unless genuinely required.
5. Do not merge the three repositories.
6. Do not implement authentication inside Caddy.
7. Prefer minimal, maintainable Caddy configurations.
8. Preserve Vite/TanStack development compatibility.
9. Validate the effective Better Auth issuer.
10. Verify callback URLs after hostname changes.
11. Keep `.localhost` development URLs separate from production configuration.
12. Do not disable TLS verification.
13. Keep application sign-in and recovery mechanisms; coordinate the hostname cutover rather than assuming old-host sessions or links survive.
14. Update both stacks' example environments and developer runbooks only when their working configuration changes.
15. Run the development browser flow through both real applications and test-production routing and discovery checks before marking implementation complete.

### Deliverables for the later implementation

- Updated development and test-production Caddyfiles and example environments in all affected repositories.
- Operator-only migration of both existing client callback pairs without credential rotation or data deletion.
- Local HTTPS trust and hostname-resolution instructions for both isolated stacks.
- Verified discovery and routing on both stacks, plus real two-app SSO on development without TLS bypasses.
- Updated developer runbooks after cutover; until then they describe the existing working origins.

---

## 15. Final Decision

Use a shared Caddy gateway for local SSO integration testing, with consistent `.localhost` domains.

Caddy handles HTTPS and routing only.

`book-auth-middleware` remains the central OIDC Identity Provider.

`book-bidding` and `read-in-peace` remain independent OIDC Relying Parties.

Each repository retains its own deployment, session, database, and application authorization responsibilities.

The gateway must be optional for independent application development and must not become a required component of the production architecture.