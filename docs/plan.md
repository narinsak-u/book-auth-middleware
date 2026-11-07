# Book Auth — Independent Application SSO Integration Specification

**Version:** 4.0  
**Status:** Proposed  
**Architecture:** Centralized OIDC Identity Provider  
**Environment:** Local Development  
**Repositories:** `book-auth-middleware`, `book-bidding`, `read-in-peace`

---

## 1. Project Overview

### 1.1 Purpose

Implement centralized Single Sign-On (SSO) across three independently running repositories using OpenID Connect (OIDC).

`book-auth-middleware` acts as the central Identity Provider (IdP), responsible for authentication, identity management, and SSO sessions.

`book-bidding` and `read-in-peace` act as OIDC Relying Parties (RP). Both delegate authentication to the IdP while maintaining their own application sessions and authorization logic.

The IdP uses Caddy as its own HTTPS reverse proxy.

**Caddy must not proxy, host, or manage the other applications.**

### 1.2 Primary Goal

The required user experience is:

1. User opens `book-bidding`.
2. User clicks Sign In.
3. `book-bidding` initiates an OIDC authorization request.
4. Browser redirects to `book-auth-middleware`.
5. User authenticates using the central login portal.
6. IdP redirects to the registered `book-bidding` callback.
7. `book-bidding` establishes an application session.
8. User returns to the originally requested page.
9. User opens `read-in-peace`.
10. `read-in-peace` initiates its own OIDC flow.
11. The IdP recognizes the existing central session.
12. Authentication completes without another login prompt, unless reauthentication or consent is required.

### 1.3 Non-Goals

- Shared reverse proxy for all repositories.
- Shared application sessions.
- Shared application databases.
- Direct application login through custom IdP endpoints.
- Custom OAuth/OIDC protocol implementation.
- API gateway for business services.
- Application dashboard or launcher.
- Changes to existing business APIs unrelated to authentication.

---

## 2. Repository Responsibilities

### 2.1 book-auth-middleware

**Role:** OIDC Identity Provider / OAuth Authorization Server

Technology:

- Turborepo + Bun Workspaces
- TanStack Start
- Elysia.js
- Better Auth
- Better Auth OAuth Provider
- Effect-TS
- Drizzle ORM
- PostgreSQL
- Caddy

Responsibilities:

- Central login and signup.
- Username/email/password authentication.
- Google OAuth.
- GitHub OAuth.
- Email verification and password recovery.
- Central SSO session management.
- OIDC authorization.
- Authorization code issuance.
- ID Token issuance.
- OAuth client registration.
- OIDC discovery and JWKS.
- Secure token handling.

### 2.2 book-bidding

**Role:** OIDC Relying Party

Development URL:

```text
http://localhost:5173
```

Responsibilities:

- Initiate OIDC login.
- Redirect users to the IdP.
- Handle OIDC callbacks.
- Validate authentication responses.
- Resolve central identities to local users.
- Create local application sessions.
- Preserve application-specific permissions.
- Restore the original requested page.

Do not implement a local credential login form.

### 2.3 read-in-peace

**Role:** OIDC Relying Party

Development services:

```text
Frontend: http://localhost:3001
Backend:  http://localhost:3000
```

Responsibilities:

- Initiate OIDC login.
- Redirect users to the IdP.
- Implement callback handling in the appropriate backend integration.
- Validate authentication responses.
- Resolve central identities to local users.
- Create local application sessions.
- Enforce application authorization.
- Restore the original requested page.

Do not implement a separate credential authentication system.

### 2.4 Caddy

**Role:** HTTPS reverse proxy for the central IdP only.

Caddy must:

- Expose the IdP through a stable HTTPS origin.
- Route frontend requests to TanStack Start.
- Route authentication endpoints to Elysia.
- Preserve request paths.
- Support OIDC discovery.
- Terminate local TLS.

Caddy must not contain upstream routes for `book-bidding` or `read-in-peace`.

---

## 3. System Architecture

```text
                      User / Browser
                            |
             +--------------+--------------+
             |                             |
             v                             v
      book-bidding                   read-in-peace
      localhost:5173                 localhost:3001
             |                             |
             |                       Backend :3000
             |                             |
             +--------------+--------------+
                            |
                            | OIDC Authorization
                            | Browser Redirect
                            v
               https://auth.localhost:8080
                            |
                            v
                          Caddy
                            |
                  +---------+---------+
                  |                   |
                  v                   v
             TanStack Start        Elysia.js
             Login Portal          Better Auth
                                      |
                                      v
                                 OIDC Provider
                                      |
                                      v
                                  PostgreSQL
```

### 3.1 Critical Architectural Principle

**SSO does not require a common reverse proxy.**

Each application communicates with the IdP through:

1. Browser-based OIDC authorization redirects.
2. Backend-to-IdP token requests.
3. OIDC metadata and public key retrieval.

The IdP does not need to know where the other applications are hosted, beyond their registered OIDC client configuration.

---

## 4. Local Development URLs

| Application | URL | Purpose |
|---|---|---|
| Book Auth | `https://auth.localhost:8080` | Central IdP |
| Book Bidding | `http://localhost:5173` | Independent application |
| Read in Peace frontend | `http://localhost:3001` | Independent application |
| Read in Peace backend | `http://localhost:3000` | Independent API |

These are development URLs only.

The architecture must support different production domains without requiring the applications to share the IdP's reverse proxy.

### 4.1 Hostname Resolution

`auth.localhost` must resolve to the development machine's loopback interface.

If the development environment does not resolve it automatically, configure a local hosts entry.

```text
127.0.0.1 auth.localhost
```

### 4.2 Port Isolation

Ports are independent between services.

- The IdP is publicly reachable through Caddy on port 8080.
- Book Bidding uses port 5173.
- Read in Peace frontend uses port 3001.
- Read in Peace backend uses port 3000.

The IdP's internal Elysia port and TanStack Start port do not conflict with application ports when services run in separate Docker network namespaces.

Do not bind multiple services to the same interface and port on the same host network.

---

## 5. Caddy Configuration

### 5.1 Required Caddyfile

The Caddyfile belongs to `book-auth-middleware`.

```caddyfile
{
    auto_https disable_redirects
}

https://auth.localhost:8080 {
    tls internal

    @backend path /api/auth /api/auth/* /api/* /.well-known/* /health /health/*

    handle @backend {
        reverse_proxy auth:3000
    }

    handle {
        reverse_proxy web:3001
    }
}
```

The `/api/*` matcher assumes custom IdP APIs belong to Elysia. If TanStack Start also owns API endpoints, define explicit path ownership instead of forwarding all `/api/*` requests to Elysia.

Additional OAuth metadata paths must be routed according to the actual Better Auth provider configuration.

### 5.2 Routing Requirements

| Request | Upstream |
|---|---|
| `/sign-in` | TanStack Start |
| `/sign-up` | TanStack Start |
| `/forgot-password` | TanStack Start |
| `/reset-password` | TanStack Start |
| `/consent` | TanStack Start |
| `/api/auth/*` | Elysia |
| `/.well-known/*` | Elysia |
| `/health/*` | Elysia |

Preserve request paths when reverse proxying.

Do not use prefix stripping for Better Auth routes unless the mounted backend explicitly requires it.

### 5.3 Forbidden Configuration

Do not include:

```caddyfile
bidding.localhost:8080 {
    reverse_proxy host.docker.internal:5173
}

reading.localhost:8080 {
    reverse_proxy host.docker.internal:3001
}
```

These applications run independently and must not depend on the IdP's gateway.

### 5.4 Docker Networking

The Caddy container must share a Docker network with:

- `auth` — Elysia backend
- `web` — TanStack Start frontend

It does not need network connectivity to the other application development servers.

---

## 6. OIDC Provider Configuration

### 6.1 Central Identity Provider

Configure Better Auth as the OIDC Provider.

Base URL:

```dotenv
BETTER_AUTH_URL=https://auth.localhost:8080
```

Use the provider's actual advertised issuer as the authoritative OIDC issuer.

For a default Better Auth base path, an expected issuer may be:

```text
https://auth.localhost:8080/api/auth
```

Validate this using OIDC discovery.

### 6.2 Provider Capabilities

Required:

- Authorization Code Flow.
- PKCE S256.
- OIDC discovery.
- ID Token issuance.
- UserInfo.
- JWKS.
- Registered OAuth clients.
- Client authentication.
- Token exchange.
- Token expiration.
- Token revocation where supported.

The provider must also support existing central authentication methods:

- Google OAuth.
- GitHub OAuth.
- Username/password.
- Email/password.

Relying Parties must not integrate Google or GitHub directly.

### 6.3 Client Registration

Register two independent OIDC clients.

**book-bidding**

```text
Client ID: book-bidding
Client Type: Confidential, if a backend securely handles the exchange
Redirect URI:
http://localhost:5173/auth/callback

Scopes:
openid profile email
```

**read-in-peace**

```text
Client ID: read-in-peace
Client Type: Confidential, if its backend securely handles the exchange
Redirect URI:
http://localhost:3001/auth/callback

Scopes:
openid profile email
```

These callback URLs are illustrative.

The actual registered callback must match the application's implemented callback handler, including scheme, hostname, port, and path.

If a backend receives the callback directly, register its reachable callback URL instead.

For browser-based public clients, use an appropriate OIDC public-client configuration with PKCE and no embedded client secret.

### 6.4 Redirect URI Security

- Use exact registered redirect URIs.
- Restrict local HTTP callbacks to explicitly approved development configurations.
- Use HTTPS callbacks in production.
- Never accept arbitrary redirect URLs.
- Never generate callback URLs from untrusted user input.
- Keep client secrets on the backend.

---

## 7. Book Bidding Authentication Flow

### 7.1 Login Initiation

When the user clicks Sign In:

1. Check the application's existing session.
2. If valid, continue to the application.
3. If missing, initiate an OIDC authorization request.
4. Generate state, nonce, and PKCE values.
5. Store the pending authentication transaction securely.
6. Redirect the browser to the IdP authorization endpoint.

Do not link directly to:

```text
https://auth.localhost:8080/sign-in
```

The application must initiate OIDC first so the authorization context is preserved.

### 7.2 IdP Login

If no central SSO session exists:

- Display the TanStack Start login form.
- Authenticate through Better Auth.
- Establish the central session.
- Resume the OIDC authorization transaction.

If a central session exists:

- Skip the login form where policy permits.
- Continue authorization.

### 7.3 Callback

After successful authorization, the IdP redirects to the registered callback with an authorization code and state.

The Relying Party must:

1. Validate state.
2. Exchange the authorization code securely.
3. Supply the PKCE verifier.
4. Validate the ID Token signature.
5. Validate issuer, audience, expiry, and nonce.
6. Extract the validated subject identifier.
7. Resolve the existing local identity link.
8. Create a local application session.
9. Restore the original destination.

Use a maintained OIDC client library.

Do not manually implement JWT signature verification or OAuth protocol parsing.

### 7.4 Original Destination

Example:

```text
Requested:
http://localhost:5173/auctions/123

OIDC Callback:
http://localhost:5173/auth/callback

Final Destination:
http://localhost:5173/auctions/123
```

Store the original relative destination with the server-side authorization transaction.

Do not use an arbitrary external return URL.

---

## 8. Read in Peace Authentication Flow

The flow follows the same OIDC architecture.

### 8.1 Frontend and Backend Separation

Current development setup:

```text
Frontend: localhost:3001
Backend: localhost:3000
```

The application must explicitly choose a callback ownership model.

**Preferred model: Backend-managed authentication**

- Backend initiates OIDC.
- Backend handles the authorization callback.
- Backend exchanges the authorization code.
- Backend validates the ID Token.
- Backend establishes the application session.
- Browser returns to the frontend.

For example:

```text
Browser
   |
   v
Reading Frontend (:3001)
   |
   v
Reading Backend (:3000)
   |
   v
OIDC Authorization at IdP
   |
   v
Backend Callback (:3000)
   |
   v
Session established
   |
   v
Frontend (:3001)
```

The actual callback endpoint must be reachable from the user's browser.

If frontend and backend use different origins, configure cookies and CORS deliberately.

Do not assume cookies will be sent correctly merely because the applications use localhost with different ports.

### 8.2 Existing SSO Session

When the user previously authenticated through Book Bidding:

1. User opens Read in Peace.
2. No local Reading session exists.
3. Reading initiates OIDC.
4. Browser visits the central IdP.
5. IdP recognizes the existing SSO session.
6. No credential prompt is required under normal SSO policy.
7. IdP redirects to the Reading callback.
8. Reading creates its own local session.
9. User returns to the original Reading page.

---

## 9. Identity Mapping and Existing Users

Both applications have existing user records.

They must preserve:

- Local user IDs.
- Business data.
- Roles and permissions.
- Existing data relationships.

### Identity Model

Use:

```text
identity_issuer
identity_subject
local_user_id
```

The issuer and subject identify the central user.

Do not use email as the primary identity key.

### Unlinked Existing Users

If an existing application user has no verified central identity link:

- Do not automatically match by email.
- Do not grant access to the existing account.
- Preserve all existing data.
- Allow verified account linking or reviewed recovery.
- Do not create duplicate accounts that might conflict with existing identities.
- Ensure recovery is available before retiring legacy login.

Existing authenticated users may securely link their accounts before their legacy sessions expire.

---

## 10. Session Management

### 10.1 Independent Sessions

The system has three separate sessions:

```text
book-auth-middleware
    Central SSO Session

book-bidding
    Local Bidding Session

read-in-peace
    Local Reading Session
```

A valid central session allows the IdP to authenticate users to new applications without another credential prompt.

It does not replace the individual application sessions.

### 10.2 Localhost Cookie Considerations

`localhost` cookies are not isolated by port.

Therefore, Book Bidding and Read in Peace must:

- Use distinct session cookie names.
- Use appropriate cookie Path attributes.
- Configure HttpOnly and SameSite attributes.
- Avoid cookie collisions.
- Prevent one application's middleware from accepting the other's session.
- Apply appropriate CSRF protection.

Prefer backend-managed sessions.

For production, use distinct application domains with HTTPS and host-only cookies.

### 10.3 Logout

Support:

- Local logout from Book Bidding.
- Local logout from Read in Peace.
- Central IdP logout.

Do not assume local logout terminates the central SSO session.

Do not claim global logout without implementing and verifying coordinated OIDC logout.

---

## 11. Local HTTPS and Trust

### 11.1 IdP TLS

The IdP uses:

```caddyfile
tls internal
```

Caddy generates certificates using its local certificate authority.

Browser and backend HTTP clients must trust this CA.

### 11.2 Backend Token Exchange

Relying-party backends need to:

- Fetch OIDC discovery metadata.
- Retrieve JWKS.
- Exchange authorization codes.
- Communicate with the HTTPS IdP.

These operations must validate the IdP TLS certificate.

Configure the development CA in the relevant runtimes and containers.

Do not disable TLS verification using insecure runtime flags.

### 11.3 Production

Use publicly trusted certificates and stable production hostnames.

Do not ship local Caddy root CA certificates in production images.

---

## 12. Implementation Tasks by Repository

### 12.1 book-auth-middleware

Required:

- Simplify the Caddyfile.
- Remove Book Bidding reverse-proxy routes.
- Remove Read in Peace reverse-proxy routes.
- Preserve TanStack Start frontend routing.
- Preserve Elysia and Better Auth API routing.
- Validate OIDC discovery and JWKS.
- Register two OIDC clients.
- Verify central session handling.
- Configure local TLS trust.

Do not modify authentication business logic unnecessarily.

### 12.2 book-bidding

Required:

- Inspect the existing authentication implementation.
- Replace local login initiation with OIDC.
- Implement the authorization callback.
- Add central identity mapping.
- Create local sessions.
- Preserve existing authorization.
- Restore original destinations.
- Test login and account linking.
- Retire old login endpoints after migration verification.

Do not configure Book Bidding inside the IdP's Caddyfile.

### 12.3 read-in-peace

Required:

- Inspect existing frontend and backend authentication.
- Select a backend-managed OIDC callback architecture.
- Replace local login initiation.
- Implement the callback.
- Validate identity tokens.
- Create local sessions.
- Configure frontend/backend cookie handling.
- Preserve user data and permissions.
- Restore original destinations.
- Verify SSO reuse.
- Retire legacy authentication after migration verification.

Do not configure Read in Peace inside the IdP's Caddyfile.

---

## 13. Testing and Verification

### Test 1 — IdP Availability

Open:

```text
https://auth.localhost:8080/sign-in
```

Expected:

- Login page loads.
- HTTPS certificate is trusted.
- Authentication API is reachable.

### Test 2 — OIDC Discovery

Retrieve:

```text
https://auth.localhost:8080/api/auth/.well-known/openid-configuration
```

Expected:

- Correct issuer.
- Correct authorization endpoint.
- Correct token endpoint.
- Valid JWKS URI.
- Correct scheme, hostname, and port.

Verify the actual metadata path from the installed provider configuration.

### Test 3 — Book Bidding Login

1. Open `http://localhost:5173`.
2. Click Sign In.
3. Confirm OIDC authorization begins.
4. Authenticate at the IdP.
5. Return to the registered callback.
6. Validate the response.
7. Create a local session.
8. Restore the original destination.

### Test 4 — Read in Peace SSO

1. Complete Book Bidding login.
2. Open `http://localhost:3001`.
3. Initiate login.
4. Confirm the IdP recognizes the central session.
5. Complete the Reading callback without another credential prompt.
6. Create a local Reading session.

### Test 5 — Legacy Login Rejection

Verify that old local credential login endpoints cannot authenticate users.

Local sign-in buttons must initiate OIDC rather than displaying legacy login forms.

### Test 6 — Unlinked User Protection

Verify that:

- Matching email alone does not link accounts.
- An unlinked central identity cannot claim an existing user.
- Existing user data remains intact.
- Verified recovery is available.

### Test 7 — Protocol Security

Reject:

- Invalid state.
- Invalid nonce.
- Incorrect PKCE verifier.
- Reused authorization codes.
- Invalid issuer.
- Incorrect audience.
- Expired tokens.
- Unregistered redirect URIs.

### Test 8 — Session Isolation

Verify:

- Each application has its own local session.
- Session cookies do not collide.
- Logging out of one application has the documented effect.
- The IdP session remains independent.

---

## 14. Implementation Order

### Phase 1 — Caddy Simplification

Repository: `book-auth-middleware`

- Remove unrelated application proxy routes.
- Keep only IdP frontend and backend routing.
- Validate Caddy configuration.
- Verify local HTTPS.
- Verify OIDC metadata.

### Phase 2 — OIDC Provider Setup

Repository: `book-auth-middleware`

- Verify OAuth Provider.
- Register Book Bidding.
- Register Read in Peace.
- Configure callbacks and client credentials.
- Verify login continuation.

### Phase 3 — Book Bidding Integration

Repository: `book-bidding`

- Add OIDC client.
- Replace local Sign In.
- Implement callback.
- Implement local sessions.
- Add identity mapping.
- Test complete login flow.

### Phase 4 — Read in Peace Integration

Repository: `read-in-peace`

- Add backend-managed OIDC integration.
- Configure frontend/backend session behavior.
- Replace local Sign In.
- Implement callback.
- Add identity mapping.
- Test central SSO reuse.

### Phase 5 — Migration and Security

All repositories:

- Verify existing-account migration.
- Test unlinked-user recovery.
- Disable legacy credential authentication.
- Test session isolation.
- Test OIDC security controls.
- Document deployment configuration.

---

## 15. Acceptance Criteria

### Infrastructure

- [ ] Caddy proxies only `book-auth-middleware`.
- [ ] No Book Bidding routes exist in the IdP Caddyfile.
- [ ] No Read in Peace routes exist in the IdP Caddyfile.
- [ ] Book Bidding runs independently on port 5173.
- [ ] Read in Peace frontend runs independently on port 3001.
- [ ] Read in Peace backend runs independently on port 3000.
- [ ] Central IdP HTTPS works.
- [ ] OIDC discovery and JWKS are accessible.

### Authentication

- [ ] Book Bidding Sign In initiates OIDC.
- [ ] Read in Peace Sign In initiates OIDC.
- [ ] IdP supports credential, Google, and GitHub login.
- [ ] Initial authentication creates a central session.
- [ ] Book Bidding callback succeeds.
- [ ] Read in Peace callback succeeds.
- [ ] SSO reuses an existing central session.
- [ ] Original destinations are restored.

### Security

- [ ] PKCE is used.
- [ ] State is validated.
- [ ] Nonce is validated.
- [ ] ID Tokens are verified.
- [ ] Redirect URIs are registered.
- [ ] Client secrets remain server-side.
- [ ] TLS verification remains enabled.
- [ ] Application sessions are independent.
- [ ] Unlinked identities cannot claim legacy accounts by email.

### Migration

- [ ] Existing application users are preserved.
- [ ] Existing business data is preserved.
- [ ] Verified account linking works.
- [ ] Legacy login endpoints are disabled after migration.
- [ ] Account recovery is available.

---

## 16. AI Coding Agent Instructions

Use this specification as the architectural source of truth.

Before implementation:

1. Inspect the actual repository structure.
2. Identify current authentication routes.
3. Identify current session handling.
4. Identify existing OIDC integration.
5. Identify real callback ownership.
6. Verify the Better Auth issuer and supported endpoints.

Implementation rules:

- Do not merge repositories.
- Do not proxy other applications through the IdP's Caddy.
- Do not implement custom OAuth protocols.
- Do not remove application authorization middleware.
- Do not automatically link accounts by email.
- Do not delete existing users or business data.
- Do not introduce shared application cookies.
- Do not disable TLS certificate verification.
- Do not hardcode client secrets.
- Do not alter unrelated business logic.
- Prefer minimal changes to existing working code.

After implementation:

- Run type checks.
- Run relevant tests.
- Validate OIDC discovery.
- Verify callback handling.
- Verify session creation.
- Verify cross-application SSO.
- Verify original-page restoration.
- Update documentation and environment examples.

---

## 17. Final Architecture Decision

`book-auth-middleware` is a standalone OIDC Identity Provider.

Its Caddy instance handles only its own frontend and backend.

`book-bidding` and `read-in-peace` remain independent applications running on their respective development ports.

They communicate with the IdP using OIDC redirects and backend token requests.

**Primary success criterion:**

A user opens Book Bidding, clicks Sign In, authenticates through Book Auth, returns to Book Bidding with a valid local session, then opens Read in Peace and completes authentication through the existing central SSO session without another login prompt.

No shared reverse proxy, shared database, or shared application session is required.