# Book Authentication — Centralized SSO Technical Specification

**Version:** 3.0  
**Status:** Proposed  
**Architecture:** Centralized Identity Provider + Independent OIDC Relying Parties  
**Monorepo:** Turborepo + Bun Workspaces  
**Identity Protocol:** OpenID Connect (OIDC) / OAuth 2.1

---

## 1. Project Overview

### 1.1 Purpose

Build a centralized Identity Provider (IdP) named `book-auth-middleware` that provides authentication and Single Sign-On (SSO) for multiple independent applications.

The initial applications are:

1. `book-bidding`
2. `read-in-peace`

Both applications currently have their own authentication systems.

The goal is to replace their existing authentication interfaces and credential-based login implementations with a single central authentication service.

Users must authenticate through `book-auth-middleware` using one of the following methods:

- Google OAuth
- GitHub OAuth
- Email and password
- Username and password

Users must also be able to register using a username, email address, and password.

After authentication, users return to the application and page they originally requested.

When users subsequently visit another connected application, they should be authenticated through the existing central SSO session without entering their credentials again.

### 1.2 Primary Objectives

- Establish `book-auth-middleware` as the single source of truth for user identity.
- Provide one login and registration interface.
- Enable SSO between independent applications.
- Support social and credential-based authentication.
- Replace legacy login and signup pages.
- Preserve existing application data and user relationships.
- Maintain independent application sessions.
- Support secure, standards-based OIDC integration.
- Keep the architecture modular, maintainable, and self-hostable.

### 1.3 Non-Goals

The initial implementation must not include:

- Application launcher/dashboard
- Centralized business API gateway
- Global application authorization management
- Multi-tenant organizations
- SAML
- Custom OAuth protocol implementation
- Client management dashboard
- Guaranteed immediate global logout
- Native mobile authentication

---

## 2. Repository Responsibilities

Three separate Git repositories must remain independently maintained and deployable.

| Repository | Role | Responsibilities |
|---|---|---|
| `book-auth-middleware` | OIDC Identity Provider | Login, signup, social login, credentials, identity, SSO sessions, token issuance |
| `book-bidding` | OIDC Relying Party | Initiate login, handle callback, create local session, enforce permissions |
| `read-in-peace` | OIDC Relying Party | Initiate login, handle callback, create local session, enforce permissions |

### Architecture

```text
                        User / Browser
                              |
                +-------------+-------------+
                |                           |
                v                           v
           book-bidding                read-in-peace
           OIDC Client A               OIDC Client B
                |                           |
                +-------------+-------------+
                              |
                              | OIDC
                              v
                  book-auth-middleware
                  Identity Provider
                              |
                  +-----------+-----------+
                  |                       |
                  v                       v
            TanStack Start             Elysia.js
            Login Portal               Auth Backend
                  |                       |
                  |                   Better Auth
                  |                       |
                  |                 +-----+------+
                  |                 |            |
                  |               Google       GitHub
                  |                 OAuth        OAuth
                  |                       |
                  +-----------------------+
                                          |
                                      PostgreSQL
```

### Architectural Principles

1. Only the IdP manages login credentials and social authentication integrations.
2. Relying Parties must not implement their own credential authentication.
3. Each Relying Party maintains its own application session.
4. Each application independently enforces authorization.
5. No shared authentication database between repositories.
6. No shared application session cookies between independent domains.
7. All identity federation must use standards-based OIDC.
8. The IdP must not proxy business API requests.

---

## 3. Central Identity Provider: book-auth-middleware

### 3.1 Technology Stack

| Component | Technology |
|---|---|
| Monorepo | Turborepo |
| Package Manager | Bun |
| Runtime | Bun |
| Frontend | TanStack Start + React |
| UI | Tailwind CSS + shadcn/ui |
| Backend | Elysia.js |
| Authentication | Better Auth |
| OIDC | Better Auth OAuth Provider |
| Functional Programming | Effect-TS |
| ORM | Drizzle ORM |
| Database | PostgreSQL |
| Deployment | Docker Compose |
| Reverse Proxy | Caddy |

### 3.2 Internal Monorepo Structure

```text
book-auth-middleware/
├── apps/
│   ├── web/
│   │   ├── src/
│   │   │   ├── routes/
│   │   │   │   ├── index.tsx
│   │   │   │   ├── sign-in.tsx
│   │   │   │   ├── sign-up.tsx
│   │   │   │   ├── forgot-password.tsx
│   │   │   │   ├── reset-password.tsx
│   │   │   │   └── consent.tsx
│   │   │   ├── components/
│   │   │   ├── features/
│   │   │   │   └── auth/
│   │   │   └── lib/
│   │   │       └── auth-client.ts
│   │   └── package.json
│   │
│   └── server/
│       ├── src/
│       │   ├── index.ts
│       │   ├── app.ts
│       │   ├── auth/
│       │   │   ├── auth.ts
│       │   │   └── provider.ts
│       │   ├── modules/
│       │   │   ├── users/
│       │   │   └── audit/
│       │   ├── shared/
│       │   │   ├── effect/
│       │   │   └── errors/
│       │   └── config/
│       └── package.json
│
├── packages/
│   ├── db/
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   └── schema/
│   │   └── migrations/
│   └── typescript-config/
│
├── scripts/
│   ├── register-clients.ts
│   └── check-oidc.ts
│
├── infrastructure/
│   ├── Caddyfile
│   ├── compose.yaml
│   └── Dockerfile
│
├── turbo.json
├── package.json
├── bun.lock
├── .env.example
└── README.md
```

Do not migrate `book-bidding` or `read-in-peace` into this monorepo.

They remain separate repositories and independent applications.

---

## 4. Authentication Methods

The IdP must support four authentication methods.

### AUTH-01: Email and Password

Requirements:

- Email/password signup.
- Email/password sign-in.
- Password validation.
- Email verification.
- Password reset.
- Secure password hashing through Better Auth.
- Session creation after successful authentication.
- Rate limiting on authentication endpoints.

### AUTH-02: Username and Password

Use Better Auth's Username plugin.

Requirements:

- Username registration.
- Username uniqueness.
- Username validation and normalization.
- Username/password login.
- Configurable username length.
- Reserved username restrictions.

The login interface should accept a username or email address.

Determine whether the identifier is an email or username and invoke the appropriate Better Auth authentication method.

Never expose whether an account exists through unnecessarily detailed login error messages.

### AUTH-03: Google OAuth

Use Better Auth's Google social provider.

Flow:

```text
Central Login Portal
        |
        v
Continue with Google
        |
        v
Google Authorization
        |
        v
Google OAuth Callback
        |
        v
Better Auth Account Resolution
        |
        v
Central SSO Session
        |
        v
Resume Original OIDC Flow
```

Requirements:

- Google OAuth application credentials.
- Secure OAuth callback.
- Verified provider identity.
- User creation when allowed.
- Existing account linking according to a secure policy.
- Central session establishment.

### AUTH-04: GitHub OAuth

Use Better Auth's GitHub social provider.

Requirements:

- GitHub OAuth application credentials.
- Secure callback.
- User creation when allowed.
- GitHub account linking.
- Safe handling of private, missing, or unverified email addresses.
- Central session establishment.
- Resume original OIDC flow.

### Account Linking Policy

A single IdP user may authenticate through multiple methods.

Example:

```text
User: usr_123
|
+-- Email + Password
|
+-- Google Account
|
+-- GitHub Account
```

Requirements:

- Prefer explicit linking from an authenticated session.
- Do not automatically merge unrelated accounts based solely on matching emails.
- Validate provider account identity.
- Prevent duplicate identity mappings.
- Allow additional providers to be linked safely.
- Prevent unauthorized account takeover.

### Username Policy for Social Signups

Social providers may not return a suitable username.

For the MVP:

- Username is required for credential signup.
- Username is optional for initial social signup.
- Social users receive a unique central identity regardless of username availability.
- A later account setup step may allow social users to select a username.
- Do not block a successful social login solely because a username is missing.

---

## 5. Central Login Portal

### 5.1 Framework

TanStack Start with React and TypeScript.

The frontend provides only authentication-related interfaces.

### 5.2 Routes

| Route | Purpose |
|---|---|
| `/sign-in` | Login interface |
| `/sign-up` | Registration |
| `/forgot-password` | Request password reset |
| `/reset-password` | Set new password |
| `/consent` | OIDC consent when required |
| `/` | Minimal authenticated state or redirect |

### 5.3 Sign-In Form

Required elements:

- Application identity/logo
- Username or email input
- Password input
- Sign-in button
- Continue with Google button
- Continue with GitHub button
- Forgot password link
- Sign-up link
- Loading state
- Authentication error messages

### 5.4 Sign-Up Form

Required fields:

```text
Name
Username
Email
Password
Confirm Password
```

Validation:

- Valid email format.
- Unique username.
- Password policy.
- Password confirmation.
- Required field validation.
- Server-side validation.
- Appropriate user feedback.

### 5.5 Redirect Behavior

The portal must support authentication initiated by an OIDC Relying Party.

When the user arrives from a connected application:

1. Preserve the signed OIDC authorization context.
2. Display the login form if the central session is missing.
3. Authenticate using the selected method.
4. Resume the existing authorization flow.
5. Let Better Auth complete authorization.
6. Return to the registered relying-party callback.

Do not implement custom redirect logic that bypasses the OIDC provider.

Do not trust arbitrary callback URLs from query parameters.

Use the Better Auth OAuth Provider client integration to continue authorization after sign-in or signup.

### 5.6 Direct Login

If a user visits `/sign-in` without an existing OIDC authorization request:

- Allow direct authentication.
- Display a minimal authenticated state or safe local destination after success.
- Do not require an originating application.
- Do not invent a callback URL.

---

## 6. OIDC Identity Provider

### OIDC-01: Provider Configuration

Use Better Auth OAuth Provider.

Required capabilities:

- Authorization Code Flow
- PKCE S256
- OIDC discovery
- ID Token issuance
- UserInfo
- JWKS
- OAuth client registration
- Token endpoint
- Token revocation
- Refresh tokens where required
- Registered redirect URI validation
- Consent management

Use Better Auth's JWT plugin where required by its OAuth Provider.

Do not implement token signing, protocol endpoints, or cryptographic validation manually.

### OIDC-02: Client Registration

Register two first-party confidential web clients.

**Client A**

```text
Name: book-bidding
Client ID: book-bidding
Scopes: openid profile email
Redirect URI:
https://book-bidding.example.com/auth/callback
```

**Client B**

```text
Name: read-in-peace
Client ID: read-in-peace
Scopes: openid profile email
Redirect URI:
https://read-in-peace.example.com/auth/callback
```

These domains are placeholders.

Client IDs must come from actual registered client records.

Each client must have independent credentials.

Requirements:

- Registered redirect URIs.
- Client authentication.
- PKCE S256.
- Restricted scopes.
- Client enable/disable support.
- Secure credentials.
- Administrator-controlled registration.

Trusted first-party clients may skip the consent screen when explicitly configured.

### OIDC-03: Provider Metadata

Expose valid OIDC discovery metadata.

The provider must advertise:

- Issuer
- Authorization endpoint
- Token endpoint
- UserInfo endpoint
- JWKS URI
- Supported scopes
- Supported response types
- Supported client authentication methods

Client applications must discover protocol URLs rather than hardcoding internal endpoint paths.

### OIDC-04: Identity Claims

The ID Token must identify the authenticated user.

Expected standard claims include:

```json
{
  "iss": "https://auth.example.com/api/auth",
  "sub": "usr_123",
  "aud": "book-bidding",
  "exp": 1900000000,
  "iat": 1899996400
}
```

The values above are illustrative.

Requirements:

- Stable issuer.
- Stable subject within the provider's subject policy.
- Correct audience.
- Valid signature.
- Valid timestamps.
- Nonce validation where required.

Use `(issuer, subject)` as the durable identity mapping.

Do not use email addresses as permanent identity keys.

---

## 7. Authentication Flow

### 7.1 First Login — book-bidding

```text
User
 |
 v
book-bidding
 |
 | No application session
 v
Initiate OIDC Authorization
 |
 v
book-auth-middleware
 |
 | No central session
 v
TanStack Start Login Portal
 |
 +-- Google
 |
 +-- GitHub
 |
 +-- Username / Password
 |
 +-- Email / Password
 |
 v
Better Auth
 |
 | Authentication successful
 v
Central SSO Session
 |
 v
Continue OIDC Authorization
 |
 v
Authorization Code
 |
 v
book-bidding Callback
 |
 | Exchange code
 | Validate identity
 | Resolve local user
 | Create local session
 v
Original Requested Page
```

### 7.2 Subsequent Login — read-in-peace

```text
User
 |
 v
read-in-peace
 |
 | No application session
 v
OIDC Authorization
 |
 v
book-auth-middleware
 |
 | Central session exists
 v
Skip Login Form
 |
 v
Complete OIDC Authorization
 |
 v
read-in-peace Callback
 |
 | Validate identity
 | Resolve local user
 | Create local session
 v
Original Requested Page
```

No second password entry should be required while the central session is valid, unless reauthentication or consent is required by policy.

### 7.3 Original Destination

Each Relying Party must preserve its original requested page.

For example:

```text
Original:
https://book-bidding.example.com/auctions/123

OIDC Callback:
https://book-bidding.example.com/auth/callback

Final:
https://book-bidding.example.com/auctions/123
```

Store the original destination with the relying party's server-side login transaction.

Associate it with OAuth `state`.

After callback validation, restore the destination.

Never allow arbitrary external destination URLs.

---

## 8. Repository Changes: book-bidding

### 8.1 Remove Legacy Authentication UI

Remove or replace:

- Existing login page
- Existing signup page
- Password reset page
- Social login buttons
- Registration form
- Local credential authentication flow

Replace login entry points with OIDC initiation.

Existing navigation may retain a "Sign In" button, but it should begin OIDC authorization instead of displaying a local form.

### 8.2 Add OIDC Integration

Implement backend routes equivalent to:

```text
GET /auth/login
GET /auth/callback
POST /auth/logout
```

Exact routes may differ depending on the project's framework.

Responsibilities:

- Generate authorization request.
- Generate `state`.
- Generate `nonce`.
- Generate PKCE verifier/challenge.
- Store the pending transaction securely.
- Redirect browser to the IdP.
- Validate callback state.
- Exchange authorization code.
- Validate ID Token.
- Resolve local user.
- Create local session.
- Restore original destination.

Use a maintained OIDC client library compatible with the existing backend.

### 8.3 Preserve Local Authorization

Keep:

- Application users
- Roles and permissions
- Bidding records
- Business data
- Protected API middleware
- Resource ownership checks

The application must continue checking user permissions independently of the IdP.

### 8.4 Identity Mapping

Add or maintain a unique mapping:

```text
identity_issuer
identity_subject
local_user_id
```

Do not replace existing primary keys or reassign business records unnecessarily.

---

## 9. Repository Changes: read-in-peace

Apply the same migration strategy.

### Remove

- Legacy login UI
- Legacy signup UI
- Local password authentication
- Local social authentication
- Legacy password reset pages

### Add

- OIDC login initiation
- OIDC callback
- Token validation
- Central identity mapping
- Local application session
- Logout handling
- Protected route integration

### Preserve

- Local users
- Reading-related records
- Roles and permissions
- Application business logic
- Existing database relationships

The application's authentication backend changes, but its business behavior must remain unaffected.

---

## 10. Local Session Design

The central IdP and Relying Parties maintain separate sessions.

```text
book-auth-middleware
    Central SSO Session

book-bidding
    Local Application Session

read-in-peace
    Local Application Session
```

### Requirements

- HTTP-only session cookies.
- Secure cookies in production.
- Appropriate SameSite configuration.
- Application-specific session expiration.
- Server-side token storage for backend-managed OIDC clients.
- No OAuth token storage in browser localStorage.
- No client secrets in frontend bundles.

Applications must check their local sessions first.

If the local session is valid, continue without contacting the IdP for every request.

If the local session is missing or expired, initiate OIDC authentication.

### Logout

Distinguish between:

1. Local application logout.
2. Central IdP logout.
3. Coordinated global logout.

The MVP must support local and central logout with documented behavior.

Global logout across all applications is a later feature unless a supported, tested OIDC back-channel logout implementation is added.

---

## 11. Existing User Migration

### 11.1 Migration Goal

Preserve existing user accounts and their associated data while transitioning authentication to the central IdP.

### 11.2 Target Identity Model

```text
Central IdP
└── user
    ├── id: usr_123
    ├── username: booklover
    ├── email: user@example.com
    └── accounts
        ├── credential
        ├── google
        └── github

book-bidding
└── users
    ├── id: bidder_10
    ├── oidc_issuer: ...
    ├── oidc_subject: usr_123
    └── role: bidder

read-in-peace
└── users
    ├── id: reader_20
    ├── oidc_issuer: ...
    ├── oidc_subject: usr_123
    └── role: reader
```

### 11.3 Migration Procedure

**Step 1 — Audit Existing Authentication**

Inspect each repository and document:

- Authentication library.
- User schema.
- Password hashing algorithm.
- Session model.
- OAuth integrations.
- Identity relationships.
- Existing user count.
- Protected routes.

**Step 2 — Back Up Databases**

Back up all existing user and application data.

Verify backup restoration before migration.

**Step 3 — Introduce Central Identity References**

Add nullable identity mapping fields or a dedicated identity mapping table.

Avoid destructive changes to existing records.

**Step 4 — Establish Central Accounts**

For each existing user, use an appropriate verified migration workflow.

Possible methods:

- Authenticated account linking.
- Verified migration of compatible credentials.
- Email verification followed by password reset.
- User-confirmed social identity linking.

Do not copy incompatible password hashes into Better Auth and assume authentication will continue working.

**Step 5 — Link Local Users**

After central authentication, associate the validated OIDC subject with the correct local user.

Prevent ambiguous or conflicting mappings.

**Step 6 — Switch Login Entry Points**

Replace local authentication UIs and login routes with OIDC.

Use staged rollout and rollback controls where practical.

**Step 7 — Retire Legacy Credential Authentication**

After successful migration:

- Disable legacy password login endpoints.
- Revoke obsolete local sessions as required.
- Remove unused credential authentication logic.
- Remove old OAuth provider secrets from application environments.
- Remove obsolete password hashes according to the approved migration and retention policy.

Do not delete local user records or business data.

---

## 12. Effect-TS Architecture

Effect-TS is used only for custom application logic.

### Responsibilities

- Audit logging
- Custom account provisioning workflows
- Typed application errors
- Dependency injection
- Repository orchestration
- Retry/timeout handling for suitable operations
- Resource lifecycle management

### Service Design

```text
Elysia Routes
     |
     v
Application Services (Effect)
     |
     +-- UserProvisioningService
     |
     +-- AuditService
     |
     +-- NotificationService
     |
     v
Repositories / Infrastructure
     |
     v
Drizzle + PostgreSQL
```

Use:

- `Effect.gen`
- `Context`
- `Layer`
- `Schema`
- `Data.TaggedError`
- `Effect.tryPromise`
- `Effect.acquireRelease` where needed

Do not duplicate Better Auth's internal authentication services.

Do not rebuild OAuth flow handling inside Effect-TS.

---

## 13. Database Management

Use Drizzle ORM with PostgreSQL.

### Central IdP Database

Better Auth owns its required authentication and OAuth tables.

Generate the schema from the installed Better Auth plugins.

Expected data categories include:

- Users
- Credentials and linked provider accounts
- Sessions
- Verification records
- OAuth clients
- Authorization grants
- Tokens
- Consents
- Signing keys

Additional custom tables may include:

- Security audit events
- Application provisioning metadata

### Database Rules

- Use versioned Drizzle migrations.
- Do not manually invent Better Auth internal tables.
- Maintain unique identity constraints.
- Use transactions for atomic operations.
- Back up data before destructive migrations.
- Never store raw OAuth tokens or passwords in audit logs.

---

## 14. Environment Configuration

### book-auth-middleware

```dotenv
NODE_ENV=development

BETTER_AUTH_URL=http://localhost:3000
BETTER_AUTH_SECRET=

DATABASE_URL=

GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=

GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=

SMTP_HOST=
SMTP_PORT=
SMTP_USER=
SMTP_PASSWORD=
SMTP_FROM=
```

### book-bidding

```dotenv
OIDC_ISSUER=https://auth.example.com/api/auth
OIDC_CLIENT_ID=book-bidding
OIDC_CLIENT_SECRET=
OIDC_REDIRECT_URI=https://book-bidding.example.com/auth/callback

SESSION_SECRET=
```

### read-in-peace

```dotenv
OIDC_ISSUER=https://auth.example.com/api/auth
OIDC_CLIENT_ID=read-in-peace
OIDC_CLIENT_SECRET=
OIDC_REDIRECT_URI=https://read-in-peace.example.com/auth/callback

SESSION_SECRET=
```

These are example configurations.

The production issuer must match the deployed provider's advertised metadata exactly.

Use actual registered client IDs and redirect URIs.

Keep all secrets server-side.

For public OAuth providers, configure the IdP's Better Auth social callbacks, typically:

```text
https://auth.example.com/api/auth/callback/google
https://auth.example.com/api/auth/callback/github
```

---

## 15. Security Requirements

### Authentication

- Secure password hashing.
- Email verification.
- Password reset token expiration.
- Username uniqueness.
- Authentication rate limiting.
- Safe account linking.
- Session fixation prevention.
- Appropriate anti-enumeration behavior.

### OIDC

- Authorization Code Flow.
- PKCE S256.
- State validation.
- OIDC nonce validation.
- Exact redirect URI matching.
- Issuer validation.
- Audience validation.
- Signature verification.
- Expiration validation.
- Single-use authorization codes.
- No implicit or password grant.

### Sessions

- HttpOnly cookies.
- Secure cookies in production.
- Suitable SameSite policy.
- CSRF protection.
- Configurable expiration.
- Session revocation.
- Server-side OAuth token storage.

### Infrastructure

- HTTPS.
- Secure secrets management.
- Protected PostgreSQL network.
- Database backups.
- Signing key persistence and rotation.
- Trusted reverse proxy configuration.
- Minimal sensitive logging.
- Graceful application shutdown.

---

## 16. Testing Requirements

### Test 1 — Credential Registration

User signs up with:

- Name
- Username
- Email
- Password

Expected:

- User is created in central IdP.
- Username is unique.
- Email verification is enforced.
- Authentication works after required verification.

### Test 2 — Google Login

Expected:

- Google redirects back to the central IdP.
- Better Auth resolves the user.
- Central session is created.
- Original OIDC authorization resumes.
- User returns to the requesting project.

### Test 3 — GitHub Login

Expected:

- GitHub authenticates the user.
- Account identity is handled securely.
- Central session is created.
- Original OIDC authorization resumes.

### Test 4 — book-bidding Login

Expected:

- User opens a protected page.
- Login redirects to IdP.
- User authenticates.
- Callback validates successfully.
- Local session is created.
- Original page is restored.

### Test 5 — SSO Reuse

Expected:

- User logs in through book-bidding.
- User opens read-in-peace.
- IdP recognizes existing central session.
- Login page is skipped.
- read-in-peace creates its local session.

### Test 6 — Invalid OIDC Callback

Reject:

- Invalid state.
- Invalid nonce.
- Invalid PKCE verifier.
- Reused authorization code.
- Unregistered redirect URI.
- Incorrect issuer.
- Incorrect token audience.
- Expired token.

### Test 7 — Authorization Isolation

Expected:

- User authenticates successfully.
- User lacks permission for a protected operation.
- Application backend denies access.

Central authentication must not bypass local permissions.

### Test 8 — Migration Integrity

Expected:

- Existing user records remain intact.
- Existing business records remain linked.
- Correct local users map to central identities.
- No accidental account merging occurs.

### Test 9 — Logout

Expected:

- Local logout invalidates the local session.
- Central logout invalidates the central session.
- Behavior of other active application sessions matches the documented policy.

---

## 17. Implementation Roadmap

### Phase 1 — Identity Provider Foundation

Repository: `book-auth-middleware`

Tasks:

- Initialize Turborepo.
- Configure Bun Workspaces.
- Create TanStack Start frontend.
- Create Elysia backend.
- Configure PostgreSQL.
- Configure Drizzle.
- Configure Effect-TS.
- Configure Better Auth.
- Implement health checks.

Deliverable: Running IdP foundation.

### Phase 2 — Authentication Methods

Repository: `book-auth-middleware`

Tasks:

- Email/password authentication.
- Username plugin.
- Google provider.
- GitHub provider.
- Login form.
- Signup form.
- Email verification.
- Password reset.
- Account linking policy.
- Session persistence.

Deliverable: Fully functional central authentication.

### Phase 3 — OIDC Provider

Repository: `book-auth-middleware`

Tasks:

- Configure OAuth Provider plugin.
- Publish discovery metadata.
- Configure signing keys and JWKS.
- Implement login continuation.
- Implement minimal consent page.
- Register book-bidding client.
- Register read-in-peace client.
- Test authorization code flow.

Deliverable: Functioning OIDC Identity Provider.

### Phase 4 — Integrate book-bidding

Repository: `book-bidding`

Tasks:

- Audit existing auth implementation.
- Add OIDC client.
- Add callback handler.
- Add identity mapping.
- Create local sessions.
- Test permissions.
- Migrate existing users.
- Replace existing login interface.
- Retire legacy authentication after verification.

Deliverable: book-bidding uses the central IdP exclusively for login.

### Phase 5 — Integrate read-in-peace

Repository: `read-in-peace`

Tasks:

- Audit existing authentication.
- Integrate OIDC.
- Implement callbacks.
- Migrate existing users.
- Implement local sessions.
- Replace legacy login interface.
- Verify SSO reuse from book-bidding.
- Retire legacy authentication after verification.

Deliverable: Both applications use centralized SSO.

### Phase 6 — Production Readiness

Repositories: All three

Tasks:

- Production Docker builds.
- Caddy HTTPS routing.
- Secure cookie configuration.
- Signing key management.
- Production database migrations.
- Rate limiting.
- Structured logging.
- Backup procedures.
- Security tests.
- End-to-end SSO tests.
- Deployment documentation.

Deliverable: Secure, deployable centralized authentication infrastructure.

---

## 18. Definition of Done

### Identity Provider

- [ ] TanStack Start login portal is functional.
- [ ] Elysia + Better Auth are integrated.
- [ ] PostgreSQL and Drizzle are configured.
- [ ] Effect-TS services are implemented where necessary.
- [ ] Username/email/password signup works.
- [ ] Username/password login works.
- [ ] Email/password login works.
- [ ] Google login works.
- [ ] GitHub login works.
- [ ] Email verification works.
- [ ] Password reset works.
- [ ] Central sessions persist correctly.
- [ ] OIDC authorization works.
- [ ] Registered clients can authenticate.
- [ ] OIDC discovery metadata and JWKS are valid.

### book-bidding

- [ ] Existing login UI is replaced.
- [ ] Existing signup UI is removed.
- [ ] Login redirects to the IdP.
- [ ] OIDC callback works.
- [ ] Local session creation works.
- [ ] Existing user data is preserved.
- [ ] Application permissions remain enforced.
- [ ] Legacy credential login is disabled.

### read-in-peace

- [ ] Existing login UI is replaced.
- [ ] Existing signup UI is removed.
- [ ] Login redirects to the IdP.
- [ ] OIDC callback works.
- [ ] Local session creation works.
- [ ] Existing user data is preserved.
- [ ] SSO session reuse works.
- [ ] Legacy credential login is disabled.

### System-Wide

- [ ] User authenticates once across both projects.
- [ ] Original application destinations are restored.
- [ ] IdP login methods are independent of relying-party implementations.
- [ ] Application authorization remains independent.
- [ ] OAuth secrets remain server-side.
- [ ] OIDC security checks pass.
- [ ] Migration integrity tests pass.
- [ ] Docker deployment works.
- [ ] HTTPS works.
- [ ] Required automated tests pass.

---

## 19. AI Coding Agent Instructions

Follow this specification as the architectural source of truth.

### Implementation Rules

1. Do not implement all three repositories simultaneously.
2. Build and verify the IdP first.
3. Integrate book-bidding before read-in-peace.
4. Review existing authentication code before deleting anything.
5. Preserve existing users and business data.
6. Use official Better Auth APIs and plugins.
7. Do not implement OAuth protocol operations manually.
8. Use established OIDC client libraries in relying parties.
9. Keep credentials and tokens out of frontend-accessible storage.
10. Do not assume social login email addresses identify existing local users.
11. Keep domain-specific permissions inside their respective applications.
12. Do not create an application launcher or admin dashboard.
13. Keep the login portal minimal.
14. Write tests for each integration.
15. Verify acceptance criteria before retiring legacy authentication.

### Implementation Workflow

For every phase:

1. Inspect the current repository.
2. Identify the authentication-related modules.
3. Produce a focused implementation plan.
4. Implement the required components.
5. Run type checking and tests.
6. Verify the authentication behavior.
7. Update relevant documentation.
8. Record any migration or security considerations.

Do not remove legacy authentication until the replacement has been tested and existing accounts can be recovered or linked.

---

## 20. Final Architecture Decision

`book-auth-middleware` will operate as a self-hosted OpenID Connect Identity Provider.

It will provide:

- A minimal login portal using TanStack Start.
- Authentication services using Elysia.js and Better Auth.
- Google and GitHub social login.
- Username/email/password signup and login.
- Central SSO sessions.
- OIDC authentication for independent applications.
- PostgreSQL persistence through Drizzle ORM.
- Effect-TS for custom services.

`book-bidding` and `read-in-peace` will become OIDC Relying Parties.

They will remove their existing authentication interfaces, delegate login and registration to the central IdP, and retain their own application sessions, user records, business data, and authorization policies.

**Primary success criterion:**

A user can open `book-bidding`, authenticate through `book-auth-middleware` using Google, GitHub, username, or email/password, return to the original page, and subsequently access `read-in-peace` without entering credentials again.
