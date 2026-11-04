# book-auth-middleware — Technical Specification

**Version:** 1.0.0  
**Status:** Proposed  
**Architecture:** Modular Monolith / Clean Architecture  
**Runtime:** Bun  
**Language:** TypeScript (Strict Mode)

---

## 1. Project Overview

### 1.1 Purpose

`book-auth-middleware` is a centralized Authentication and Single Sign-On (SSO) server designed to provide unified identity management across multiple independent web applications.

Each application may have its own:

- Frontend framework
- Backend server
- Database
- Domain or subdomain
- Business logic
- Authorization and permission rules

The central authentication server allows users to authenticate once and subsequently access other registered applications without repeatedly entering their credentials.

The system must follow OAuth 2.1 security practices and use OpenID Connect (OIDC) for identity federation.

### 1.2 Objectives

1. Provide centralized user authentication.
2. Enable Single Sign-On across multiple applications.
3. Implement a standards-based OIDC identity provider.
4. Support multiple registered OAuth/OIDC clients.
5. Centralize identity and session management.
6. Allow individual applications to maintain independent authorization rules.
7. Provide a secure, maintainable, and extensible architecture.
8. Support self-hosted deployment using Docker.

### 1.3 Non-Goals (MVP)

The initial version will not implement:

- Centralized API gateway
- Complete Identity and Access Management (IAM) platform
- Organization or multi-tenant management
- Fine-grained cross-application permissions
- SAML authentication
- Social login providers
- Machine-to-machine authentication
- Dynamic client registration
- Custom OAuth protocol implementation
- Custom password hashing or token-signing algorithms
- Universal immediate logout from every application

These features may be introduced in later versions.

---

## 2. Technology Stack

| Layer | Technology | Responsibility |
|---|---|---|
| Runtime | Bun | Execute TypeScript applications |
| HTTP Framework | Elysia.js | Routing, middleware, HTTP lifecycle |
| Authentication | Better Auth | Users, credentials, sessions, authentication |
| SSO Protocol | Better Auth OAuth Provider | OAuth 2.1 and OIDC |
| Functional Programming | Effect-TS | Business logic, errors, DI, resource management |
| ORM | Drizzle ORM | Typed database access |
| Database | PostgreSQL | Persistent authentication data |
| Validation | Effect Schema | Custom API and domain validation |
| Testing | Bun Test | Unit and integration tests |
| Containers | Docker | Application packaging |
| Orchestration | Docker Compose | Service deployment |
| Reverse Proxy | Caddy | HTTPS and reverse proxy |
| Logging | Structured JSON logging | Observability |

### 2.1 Technology Responsibilities

**Elysia.js**

- HTTP server
- Custom application routes
- Request validation and response handling
- Middleware and request lifecycle
- Mounting Better Auth's handler

**Better Auth**

- Registration and sign-in
- Password verification
- Authentication sessions
- Email verification
- Password reset
- OAuth authorization server
- OIDC identity tokens and discovery
- OAuth client registration
- Token issuance, renewal, and revocation

**Effect-TS**

- Typed custom business services
- Dependency injection through Context and Layer
- Domain-specific error handling
- Database operation orchestration
- Retry and timeout policies
- Resource management
- Testable business workflows

**Drizzle ORM**

- PostgreSQL access
- Schema definitions
- SQL migrations
- Transactions
- Type-safe queries

### 2.2 Integration Principle

Do not reimplement Better Auth's authentication and OAuth functionality using Effect-TS.

Better Auth remains responsible for protocol-level authentication behavior.

Effect-TS handles custom application services around Better Auth, including provisioning, audit logging, administration, and future domain functionality.

Elysia routes integrate Effect services at the application boundary.

---

## 3. High-Level Architecture

```text
                         USER
                          |
                          v
                  Browser / Client
                          |
                          v
                 auth.example.com
                          |
                    Caddy Proxy
                          |
                          v
              +-----------------------+
              | book-auth-middleware  |
              |-----------------------|
              | Elysia.js             |
              |                       |
              | Better Auth           |
              | - Authentication      |
              | - Session Management  |
              | - OIDC Provider       |
              | - OAuth Clients       |
              |                       |
              | Effect-TS             |
              | - Domain Services     |
              | - Error Handling      |
              | - DI / Layers         |
              | - Audit Logging       |
              |                       |
              | Drizzle ORM           |
              +-----------+-----------+
                          |
                          v
                     PostgreSQL
                          |
         OIDC Authorization / Identity
                          |
           +--------------+--------------+
           |              |              |
           v              v              v
       Project A      Project B      Project C
       Frontend       Frontend       Frontend
           |              |              |
       Backend A      Backend B      Backend C
           |              |              |
        DB A           DB B           DB C
```

### 3.1 Core Architectural Principles

1. Central authentication is independent of application-specific business logic.
2. Each application remains independently deployable.
3. Each application owns its authorization and business data.
4. Applications communicate with the identity provider using standards-based OIDC flows.
5. Authentication credentials must never be shared with application backends.
6. Application backends must validate identity and authorization.
7. The central server should not act as a proxy for unrelated application API requests.
8. Backend services must not trust unverified identity claims supplied by browsers.

---

## 4. System Components

### 4.1 Central Identity Provider

Responsibilities:

- Authenticate users.
- Manage user identities.
- Maintain central authentication sessions.
- Manage registered OAuth clients.
- Process authorization requests.
- Issue authorization codes and tokens.
- Publish OIDC discovery metadata.
- Publish public signing keys.
- Handle consent when required.
- Provide token revocation and supported logout functionality.

### 4.2 Relying Party Applications

Each application acts as an OIDC Relying Party (RP).

Responsibilities:

- Redirect unauthenticated users to the Identity Provider.
- Handle OAuth authorization callbacks.
- Exchange authorization codes securely.
- Validate OIDC identity tokens.
- Create application-specific sessions.
- Map central identities to local users.
- Enforce application-specific authorization.
- Handle local session expiration and logout.

### 4.3 PostgreSQL Database

Stores identity-provider-owned data, including:

- Users
- Accounts and credential records
- Sessions
- Verification records
- OAuth clients
- OAuth tokens and authorization grants
- Consent records
- Signing key records
- Audit events

Better Auth owns and manages the schema required by its core authentication and provider plugins.

Custom tables must remain logically separate.

---

## 5. Functional Requirements

### FR-01: User Registration

The system shall support email/password registration.

Requirements:

- Validate registration input.
- Enforce a password policy.
- Normalize email addresses safely.
- Prevent duplicate accounts.
- Store password credentials using Better Auth.
- Support email verification.
- Prevent authentication-sensitive operations with unverified email addresses when verification is required.
- Prevent account enumeration through public error messages where practical.

Registration must not immediately grant access to every connected application.

### FR-02: User Login

The system shall authenticate users using Better Auth.

Requirements:

- Email/password login.
- Secure session establishment.
- Configurable session expiration.
- Appropriate session cookie attributes.
- Rate limiting on authentication endpoints.
- Generic failure responses for invalid credentials.
- Authenticated-user session retrieval.

### FR-03: Single Sign-On

The system shall support SSO using OIDC.

Required behavior:

1. User accesses Application A.
2. Application A redirects to the central Identity Provider.
3. User authenticates.
4. Identity Provider establishes a central authentication session.
5. Application A completes the OIDC authorization flow and establishes its own session.
6. User accesses Application B.
7. Application B redirects to the same Identity Provider.
8. The Identity Provider recognizes the existing session.
9. Application B completes OIDC and establishes its local session without requiring another password entry.

SSO must work across independent domains.

Do not implement SSO by sharing an authentication cookie across unrelated application domains.

### FR-04: OIDC Provider

Use `@better-auth/oauth-provider`.

Required features:

- OpenID Connect discovery
- OAuth authorization endpoint
- Authorization Code Grant
- PKCE using S256
- ID Token issuance
- UserInfo endpoint
- Client authentication
- Token endpoint
- JWT signing key publication
- Token revocation
- Token introspection where applicable

Initial supported scopes:

```text
openid
profile
email
offline_access
```

The `offline_access` scope must only be requested for clients that require refresh tokens.

Access tokens must not be accepted as ID tokens.

### FR-05: OAuth Client Management

Each project must register as a separate OAuth/OIDC client.

Example configuration:

| Client | Type | Callback |
|---|---|---|
| book-dashboard | Confidential | https://dashboard.example.com/auth/callback |
| book-admin | Confidential | https://admin.example.com/auth/callback |
| book-survey | Confidential | https://survey.example.com/auth/callback |

Requirements:

- Unique client ID.
- Registered redirect URIs.
- Configurable scopes.
- Client authentication method.
- Client enable/disable status.
- Controlled client secret generation and rotation.
- Trusted-client consent policy.

Use administrator-managed registration for the MVP.

Unauthenticated dynamic client registration must remain disabled.

### FR-06: Session Management

The system must distinguish between:

**Central SSO Session**

Managed by the Identity Provider.

**Application Session**

Managed independently by the connected application.

Requirements:

- Secure session cookies.
- Configurable expiration.
- Session invalidation.
- Ability to terminate the central session.
- No cross-application sharing of application session cookies.
- Explicit documentation of logout behavior.

A central session ending must not be represented as proof that all relying-party sessions have ended.

### FR-07: Logout

Support:

- Logout from the central authentication server.
- RP-initiated logout where supported by the provider.
- Local logout within connected applications.

Global Single Logout is a separate capability.

If implemented later, it must use supported OIDC mechanisms and tested relying-party integrations, rather than assuming cookie deletion at the Identity Provider will invalidate every application session.

### FR-08: User Profile

Allow authenticated users to:

- Retrieve profile details.
- Update allowed profile fields.
- Change password.
- Request password reset.
- Verify email.
- View active sessions, if enabled.
- Revoke their own sessions, if enabled.

Expose these capabilities through supported Better Auth APIs wherever possible.

### FR-09: Health Monitoring

Provide operational endpoints:

```text
GET /health/live
GET /health/ready
```

`/health/live`

- Confirms the HTTP process is alive.
- Does not require authentication.
- Does not depend on optional external services.

`/health/ready`

- Confirms the service can process authentication requests.
- Checks essential database connectivity.
- Does not expose credentials or internal configuration.

### FR-10: Audit Logging

Record important security events:

- Successful login
- Failed login
- Logout
- Password reset request/completion
- Email verification
- OAuth client registration
- OAuth client modification
- OAuth client disabling
- Administrative session revocation

Logs must not contain passwords, raw session cookies, authorization codes, access tokens, refresh tokens, or client secrets.

---

## 6. Authentication Workflows

### 6.1 Authorization Code + PKCE

```text
Browser          Project Backend       Auth Server
   |                   |                    |
   |-- Open App ------>|                    |
   |                   |                    |
   |<-- Redirect ------|                    |
   |                   |                    |
   |------------ Authorization Request ---->|
   |                   |                    |
   |<--------------- Login Page ------------|
   |                   |                    |
   |---------------- Authenticate --------->|
   |                   |                    |
   |<--------- Redirect with Code ----------|
   |                   |                    |
   |-- Code Callback ->|                    |
   |                   |                    |
   |                   |-- Code + Verifier->|
   |                   |                    |
   |                   |<-- Token Response -|
   |                   |                    |
   |                   | Validate ID Token  |
   |                   | Create App Session |
   |                   |                    |
   |<-- Session Cookie-|                    |
   |                   |                    |
   |-- App Request --->|                    |
```

Requirements:

- Generate a cryptographically random `state`.
- Generate and bind an OIDC `nonce`.
- Generate a PKCE verifier and S256 challenge.
- Validate `state` when handling the callback.
- Exchange the code on the backend for confidential clients.
- Validate ID Token issuer, audience, expiry, signature, and nonce as applicable.
- Reject reused or invalid authorization codes.
- Use exact registered callback URLs.
- Store OAuth tokens server-side for BFF-style applications.

Use an established OIDC client library in each consuming application.

### 6.2 Returning User SSO

```text
User opens Project B
        |
        v
Project B redirects to Auth Server
        |
        v
Auth Server checks existing SSO session
        |
        +-- Session valid
        |       |
        |       v
        |  OIDC authorization continues
        |       |
        |       v
        |  Project B creates local session
        |
        +-- Session invalid
                |
                v
             Login Page
```

Authentication reuse must not bypass authorization or consent policies.

---

## 7. Authorization Strategy

Authentication and authorization must be separate concerns.

The Identity Provider answers:

> Who is this user?

Each application backend answers:

> What is this user allowed to do?

Example:

```text
User: usr_123

Project A:
  Role = Admin

Project B:
  Role = Editor

Project C:
  Role = Viewer
```

The Identity Provider must not assume that successful authentication grants access to all applications.

Each application must explicitly evaluate entitlement, membership, and permission rules.

### 7.1 Identity Mapping

Use validated OIDC identity claims to link local users with central identities.

Recommended application-side identity mapping:

```text
identity_issuer
identity_subject
local_user_id
```

The pair `(identity_issuer, identity_subject)` must be unique within each application.

Do not automatically merge existing accounts based solely on matching email addresses.

For the MVP, use public subject identifiers so the same central identity can be recognized across first-party clients. If pairwise subjects are introduced later, establish a privacy-preserving account mapping strategy before migration.

---

## 8. Application Architecture

Use a modular monolith with Clean Architecture principles.

Organize custom application code into:

1. Domain
2. Application
3. Infrastructure
4. Presentation

Keep Better Auth as an isolated identity infrastructure subsystem.

### 8.1 Domain Layer

Contains:

- Domain entities
- Value objects
- Domain-specific errors
- Business invariants
- Repository contracts where needed

Must not directly import Elysia, Drizzle, or Better Auth-specific HTTP functionality.

### 8.2 Application Layer

Contains:

- Use cases
- Application services
- Effect service definitions
- Dependency contracts
- Application error handling
- Business workflow orchestration

Use Effect-TS for custom services.

### 8.3 Infrastructure Layer

Contains:

- PostgreSQL connection
- Drizzle repositories
- Better Auth configuration
- OAuth Provider integration
- Email delivery adapter
- Audit event persistence
- Effect Layer implementations
- Logging adapters

### 8.4 Presentation Layer

Contains:

- Elysia HTTP server
- Custom HTTP routes
- Request/response schemas
- Middleware
- Error mapping
- Health endpoints

Better Auth-owned routes should be mounted directly rather than rewritten as custom Effect routes.

---

## 9. Recommended Directory Structure

```text
book-auth-middleware/
├── src/
│   ├── index.ts
│   ├── app.ts
│   │
│   ├── config/
│   │   ├── env.ts
│   │   └── constants.ts
│   │
│   ├── auth/
│   │   ├── auth.ts
│   │   ├── auth-client.ts
│   │   ├── oauth-provider.ts
│   │   └── auth-handler.ts
│   │
│   ├── modules/
│   │   ├── users/
│   │   │   ├── domain/
│   │   │   ├── application/
│   │   │   ├── infrastructure/
│   │   │   └── presentation/
│   │   │
│   │   ├── oauth-clients/
│   │   │   ├── domain/
│   │   │   ├── application/
│   │   │   ├── infrastructure/
│   │   │   └── presentation/
│   │   │
│   │   └── audit/
│   │       ├── domain/
│   │       ├── application/
│   │       └── infrastructure/
│   │
│   ├── shared/
│   │   ├── effect/
│   │   │   ├── runtime.ts
│   │   │   └── layers.ts
│   │   ├── errors/
│   │   ├── middleware/
│   │   ├── logging/
│   │   └── schemas/
│   │
│   └── db/
│       ├── index.ts
│       ├── schema/
│       │   ├── auth.schema.ts
│       │   ├── audit.schema.ts
│       │   └── index.ts
│       └── migrations/
│
├── scripts/
│   ├── seed-clients.ts
│   └── check-oidc.ts
│
├── tests/
│   ├── unit/
│   ├── integration/
│   └── e2e/
│
├── docs/
│   ├── architecture.md
│   ├── oidc-integration.md
│   ├── security.md
│   └── deployment.md
│
├── Dockerfile
├── compose.yaml
├── drizzle.config.ts
├── package.json
├── tsconfig.json
├── .env.example
├── .gitignore
└── README.md
```

**Structure rules:**

- Avoid creating unnecessary abstractions.
- Introduce repository interfaces only when they provide meaningful boundaries.
- Avoid duplicating Better Auth's internal domain models.
- Keep modules independently understandable.
- Favor composition over inheritance.
- Do not use a global mutable dependency container.

---

## 10. Effect-TS Design

Use Effect-TS for custom domain and application operations, not as a replacement for Better Auth.

### 10.1 Service Pattern

Services should be defined using Effect's supported dependency injection APIs.

Conceptual services:

```text
AuditService
UserProvisioningService
OAuthClientAdministrationService
NotificationService
```

Example dependency graph:

```text
                 Application Layer
                        |
             +----------+----------+
             |                     |
       UserProvisioning       AuditService
             |                     |
             v                     v
       UserRepository       AuditRepository
             |                     |
             +----------+----------+
                        |
                        v
                    Drizzle DB
                        |
                        v
                    PostgreSQL
```

### 10.2 Effect Requirements

Use:

- `Effect.gen` for sequential business workflows.
- `Effect.tryPromise` for custom Promise-based integrations.
- `Data.TaggedError` for typed application failures.
- `Context` and `Layer` for dependency injection.
- `Schema` for custom domain input validation.
- `Effect.all` for safe concurrent operations.
- `Effect.retry` only for transient failures.
- `Effect.timeout` for bounded external operations.
- `Effect.acquireRelease` for custom managed resources where appropriate.

### 10.3 Runtime Integration

Elysia remains the HTTP entry point.

Application execution:

```text
HTTP Request
     |
     v
Elysia Route
     |
     v
Input Validation
     |
     v
Effect Application Service
     |
     v
Repository / External Adapter
     |
     v
Result or Typed Error
     |
     v
HTTP Response
```

Create application Effect Layers during server initialization and provide them through a managed runtime or equivalent lifecycle-safe integration.

Do not reconstruct database pools or dependency graphs on every request.

Do not use `Effect.runPromise` arbitrarily inside domain services. Execute effects at the application boundary.

### 10.4 Error Model

Suggested application errors:

```text
ValidationError
UnauthorizedError
ForbiddenError
ResourceNotFoundError
ConflictError
DatabaseError
ExternalServiceError
```

Map application errors to consistent HTTP responses:

| Error | HTTP Status |
|---|---|
| ValidationError | 400 / 422 |
| UnauthorizedError | 401 |
| ForbiddenError | 403 |
| ResourceNotFoundError | 404 |
| ConflictError | 409 |
| DatabaseError | 500 / 503 |
| ExternalServiceError | 502 / 503 |

Do not expose internal database errors or stack traces to clients.

Do not override Better Auth's standardized OAuth error responses with a custom incompatible error format.

---

## 11. Database Specification

### 11.1 Database Ownership

Better Auth controls its required identity and provider tables.

Use the Better Auth CLI to generate the current Drizzle schema for all enabled plugins.

Do not manually invent Better Auth table definitions or migration structures.

Use Drizzle Kit to generate and apply reviewed migrations.

### 11.2 Core Authentication Tables

Expected categories include:

```text
user
session
account
verification
```

### 11.3 OAuth Provider Tables

Expected categories include:

```text
OAuth clients
OAuth grants
Authorization codes
Access/refresh tokens
Consent records
```

Actual table names and columns must follow the installed Better Auth OAuth Provider version.

### 11.4 Custom Audit Table

Create a custom table for operational audit events.

Suggested fields:

| Field | Type | Description |
|---|---|---|
| id | UUID | Primary key |
| actor_id | TEXT nullable | Identity performing action |
| event_type | TEXT | Event identifier |
| client_id | TEXT nullable | Related OAuth client |
| resource_id | TEXT nullable | Affected resource |
| ip_address | INET nullable | Request IP where appropriate |
| user_agent | TEXT nullable | Client user agent |
| metadata | JSONB | Sanitized event metadata |
| created_at | TIMESTAMPTZ | Event timestamp |

Use indexes for:

- `actor_id`
- `event_type`
- `created_at`
- `client_id` where useful

Never place credentials, authorization codes, access tokens, refresh tokens, or full session cookies in audit metadata.

### 11.5 Migration Strategy

- Generate Better Auth schemas from the pinned plugin versions.
- Maintain migrations in version control.
- Run migrations as a dedicated deployment step.
- Do not perform automatic production schema synchronization on every startup.
- Back up production data before destructive migrations.
- Test migration compatibility before deploying new application versions.

---

## 12. API Specification

### 12.1 Authentication Endpoints

Better Auth owns its authentication API under the configured base path.

Example:

```text
/api/auth/*
```

Do not manually reimplement sign-in, sign-out, session, credential, or OAuth endpoints if Better Auth provides them.

### 12.2 OIDC Endpoints

The exact endpoint URLs must be resolved from the deployed provider's discovery metadata.

Expected capabilities include:

```text
Authorization
Token exchange
UserInfo
JWKS
Token revocation
Token introspection
OIDC discovery
```

A standard OIDC discovery entry point is:

```text
{issuer}/.well-known/openid-configuration
```

The configured issuer is authoritative.

Client applications must discover endpoints instead of hardcoding assumptions about provider-internal paths.

### 12.3 Custom Application Endpoints

Implement:

```text
GET /health/live
GET /health/ready
```

Optional protected operational routes:

```text
GET /internal/version
```

Do not expose internal administrative functions publicly without an explicit requirement.

For MVP OAuth client registration, use Better Auth's administrator-controlled server APIs through a protected provisioning script rather than implementing a new public client-management API.

### 12.4 Standard Error Response

For custom non-OAuth endpoints:

```json
{
  "error": {
    "code": "RESOURCE_NOT_FOUND",
    "message": "Resource not found",
    "requestId": "req_example"
  }
}
```

Never expose raw exception objects in production.

---

## 13. Security Requirements

### SEC-01: HTTPS

All production authentication endpoints must use HTTPS.

Caddy terminates public TLS connections.

Forwarded host and protocol headers must only be trusted from configured reverse proxies.

### SEC-02: Session Cookies

Production cookies must be:

- HttpOnly
- Secure
- Appropriately configured with SameSite
- Restricted to the required domain and path
- Protected against session fixation

Prefer host-only cookies for the central authentication domain.

### SEC-03: OAuth Security

Require:

- Authorization Code Flow
- PKCE S256
- State validation
- Nonce validation for OIDC
- Exact redirect URI matching
- Strict issuer validation
- Token audience validation
- Cryptographically secure random values
- Secure authorization-code exchange

Do not enable implicit flow or resource-owner password grant.

### SEC-04: Token Security

- Keep signing keys private.
- Expose only public keys through JWKS.
- Support signing key rotation.
- Validate expiry and issuer.
- Use audience-scoped access tokens for protected resources.
- Use short-lived access tokens where practical.
- Restrict refresh token issuance.
- Apply refresh token rotation and revocation policies.
- Never store OAuth tokens in browser localStorage for the recommended BFF architecture.
- Never use an ID Token as an API authorization token.

### SEC-05: Abuse Protection

Implement:

- Login rate limiting
- Password reset rate limiting
- Registration abuse protection
- Request body size limits
- Input validation
- Appropriate CORS policies
- CSRF protection for cookie-authenticated state-changing operations
- Security headers

### SEC-06: Secrets

Sensitive values must come from environment variables or a secrets manager.

Never commit:

```text
BETTER_AUTH_SECRET
DATABASE_URL
CLIENT_SECRET
SIGNING_PRIVATE_KEY
EMAIL_PROVIDER_SECRET
```

`.env.example` must contain placeholders only.

### SEC-07: Client Access Control

- Client registration requires administrator authorization.
- Disable open/unauthenticated client registration.
- Review and approve redirect URIs.
- Restrict requested scopes.
- Allow client deactivation.
- Restrict client secret access.
- Record security-sensitive client changes.

---

## 14. Configuration

Provide `.env.example` with non-sensitive placeholders.

```dotenv
# Application
NODE_ENV=development
PORT=3000
APP_URL=http://localhost:3000

# Better Auth
BETTER_AUTH_URL=http://localhost:3000
BETTER_AUTH_SECRET=replace-with-secure-secret

# PostgreSQL
DATABASE_URL=postgresql://user:password@localhost:5432/book_auth

# Logging
LOG_LEVEL=info

# Email delivery
SMTP_HOST=
SMTP_PORT=
SMTP_USER=
SMTP_PASSWORD=
SMTP_FROM=

# OAuth
OIDC_ISSUER=http://localhost:3000/api/auth
```

`OIDC_ISSUER` represents the intended issuer for integration checks; it must match the provider's actual configured and advertised issuer. It must not silently override Better Auth's issuer configuration.

Validate required configuration at application startup using Effect Schema or an equivalent robust schema.

Fail fast on invalid required configuration.

For production:

```text
BETTER_AUTH_URL=https://auth.example.com
```

Use a single canonical external issuer URL consistently.

---

## 15. Logging and Observability

Use structured JSON logging.

Include:

```text
timestamp
level
service
requestId
event
durationMs
statusCode
```

Requirements:

- Assign a request ID to each inbound request.
- Correlate HTTP logs with custom Effect workflows.
- Log failures with sanitized context.
- Never log secrets or tokens.
- Provide health endpoints.
- Support graceful shutdown.
- Track authentication and database errors.

Recommended operational metrics:

- HTTP request latency
- Login success/failure counts
- OAuth authorization error counts
- Database connection failures
- Token endpoint errors
- Rate-limited requests

Metrics infrastructure may be added after the MVP, but the code should support future observability integrations.

---

## 16. Testing Strategy

### 16.1 Unit Tests

Test:

- Input validation
- Effect service behavior
- Typed errors
- User provisioning rules
- Audit event creation
- Configuration parsing

Use mock Effect Layers for isolated tests.

### 16.2 Integration Tests

Use a dedicated PostgreSQL test database.

Test:

- Database migrations
- Better Auth persistence
- Session creation
- Session invalidation
- OIDC client registration
- Database transaction behavior
- Audit persistence

### 16.3 End-to-End Tests

Provide two simple test clients.

```text
test-app-a
test-app-b
```

Required SSO test:

1. Visit App A.
2. Redirect to central login.
3. Authenticate.
4. Return to App A successfully.
5. Visit App B.
6. Redirect to central auth.
7. Reuse existing SSO session.
8. Return to App B without another credential prompt.

Additional security tests:

- Invalid redirect URI rejected.
- Invalid PKCE verifier rejected.
- Reused authorization code rejected.
- Invalid state rejected.
- Invalid nonce rejected.
- Expired ID Token rejected.
- Incorrect issuer rejected.
- Incorrect audience rejected.
- Unauthorized client administration rejected.
- Unverified identities handled according to policy.
- Local logout and central logout behaviors verified.
- A logged-in user without Project B access is denied by Project B.

---

## 17. Deployment Architecture

Use Docker Compose for the initial self-hosted deployment.

```text
                     Internet
                        |
                      HTTPS
                        |
                        v
                      Caddy
                        |
                        v
                Elysia Auth Server
                        |
                        v
                    PostgreSQL
```

### 17.1 Services

**Caddy**

- HTTPS
- Reverse proxy
- Security headers
- Request forwarding

**Auth Server**

- Bun runtime
- Elysia.js application
- Better Auth
- Effect application services

**PostgreSQL**

- Persistent storage
- Docker volume
- Health checks
- Backup support

### 17.2 Container Requirements

- Multi-stage Docker build.
- Production dependency installation.
- Non-root execution where possible.
- Minimal runtime image.
- Health check support.
- Graceful termination.
- Restart policy.
- No embedded credentials.
- Database accessible only through a private network.

### 17.3 Deployment Rules

- Publish the auth server through one stable HTTPS domain.
- Do not directly expose PostgreSQL to the public Internet.
- Run migrations before starting the new production application version.
- Make database backups.
- Persist required signing keys securely.
- Use environment-specific configuration.
- Test OIDC metadata from the public domain after deployment.

---

## 18. Development Phases

### Phase 1 — Foundation

Implement:

- Bun project initialization
- TypeScript strict configuration
- Elysia application
- Environment validation
- PostgreSQL connection
- Drizzle setup
- Effect runtime and foundational Layers
- Health endpoints
- Structured logging
- Docker development environment

**Acceptance criteria:**

- The server starts successfully.
- PostgreSQL connectivity works.
- The health endpoints respond correctly.
- Missing configuration causes startup failure.
- The application shuts down cleanly.

### Phase 2 — Better Auth Integration

Implement:

- Better Auth configuration
- Drizzle adapter
- Email/password authentication
- Registration
- Sign-in
- Sign-out
- Session retrieval
- Email verification
- Password reset
- Database migrations

**Acceptance criteria:**

- Users can register.
- Users can authenticate.
- Sessions persist correctly.
- Logout invalidates the appropriate session.
- Authentication records persist in PostgreSQL.
- Password reset and email verification are testable with a development email transport.

### Phase 3 — OIDC Provider

Implement:

- OAuth Provider plugin
- JWT signing and JWKS
- OIDC metadata
- Authorization Code Flow
- PKCE
- OIDC scopes
- Client registration script
- Consent page
- Login page integration

**Acceptance criteria:**

- OIDC metadata is accessible.
- A registered client can initiate authorization.
- Invalid redirect URIs are rejected.
- Authorization codes can be exchanged.
- ID Tokens validate successfully.
- An unregistered client cannot complete authorization.

### Phase 4 — SSO Integration

Implement:

- Demo Application A
- Demo Application B
- OIDC client configuration
- Callback handlers
- Independent application sessions
- Local identity mapping
- Session reuse test

**Acceptance criteria:**

- Login to App A succeeds.
- Opening App B does not require another password entry while the SSO session is valid.
- Both applications have independent sessions.
- Local permissions are respected.
- Session expiry and reauthentication behave correctly.

### Phase 5 — Custom Effect Services

Implement:

- AuditService
- AuditRepository
- OAuth client administration workflows
- Typed error mapping
- Request correlation
- Dependency injection tests

**Acceptance criteria:**

- Custom service logic is Effect-based.
- Service dependencies can be replaced with test Layers.
- No duplicate implementation of Better Auth functionality exists.
- Typed application errors are handled consistently.

### Phase 6 — Production Readiness

Implement:

- Production Dockerfile
- Docker Compose deployment
- Caddy configuration
- HTTPS
- Rate limiting
- Secure cookie configuration
- Security headers
- Migration procedure
- Backup procedure
- Deployment documentation
- End-to-end security tests

**Acceptance criteria:**

- Production deployment starts successfully.
- Public OIDC discovery metadata is valid.
- SSO works over HTTPS.
- Secrets are not exposed.
- Container restarts preserve required identity data.
- Database restoration has been tested.

---

## 19. AI Coding Agent Instructions

When implementing `book-auth-middleware`, follow these constraints.

### General Rules

1. Use Bun as the runtime and package manager.
2. Use TypeScript strict mode.
3. Use Elysia.js as the HTTP framework.
4. Use Better Auth for authentication and OIDC.
5. Use Effect-TS for custom application logic.
6. Use Drizzle ORM with PostgreSQL.
7. Use current stable package versions compatible with one another.
8. Follow the official documentation for all libraries.
9. Prefer small, focused modules.
10. Avoid unnecessary dependencies and abstractions.

### Architecture Rules

1. Follow the defined modular architecture.
2. Keep domain services independent of Elysia.
3. Do not duplicate Better Auth functionality.
4. Use Effect Context and Layer for custom service dependencies.
5. Handle errors using typed Effect failures.
6. Keep infrastructure dependencies out of the domain layer.
7. Keep OAuth protocol handling inside supported provider/client libraries.
8. Avoid global mutable service containers.

### Database Rules

1. Generate Better Auth schemas using the installed CLI.
2. Use Drizzle migrations.
3. Commit generated migrations.
4. Use transactions where operations must be atomic.
5. Do not manually edit Better Auth tables without a documented reason.
6. Keep custom tables separate from generated authentication tables.

### Security Rules

1. Never hardcode secrets.
2. Never log credentials or tokens.
3. Validate configuration at startup.
4. Require PKCE for OIDC authorization-code clients.
5. Validate issuer and audience.
6. Use secure cookie settings.
7. Enforce application-specific authorization independently.
8. Do not enable anonymous OAuth client registration.
9. Do not implement homemade cryptographic primitives.

### Quality Rules

1. Write unit tests for custom application services.
2. Write integration tests for database operations.
3. Write end-to-end tests for SSO.
4. Use descriptive naming.
5. Handle failures explicitly.
6. Avoid silent exception swallowing.
7. Document non-obvious architectural decisions.
8. Keep the README synchronized with implementation.
9. Do not introduce unused files or placeholder abstractions.

### Implementation Workflow

For each development phase:

1. Review the current codebase.
2. Identify the required changes.
3. Implement the smallest working solution.
4. Run linting and type checking.
5. Run relevant tests.
6. Resolve failures.
7. Update documentation.
8. Verify phase acceptance criteria.

Do not mark a phase complete unless its acceptance criteria have been verified.

---

## 20. Definition of Done

The project is considered MVP-complete when:

- [ ] Central Elysia authentication server runs successfully.
- [ ] Better Auth uses PostgreSQL through Drizzle ORM.
- [ ] Email/password authentication works.
- [ ] Email verification and password reset work.
- [ ] Central authentication sessions work.
- [ ] OAuth/OIDC Provider is configured.
- [ ] OIDC discovery metadata is valid.
- [ ] OAuth clients can be registered securely.
- [ ] Authorization Code + PKCE works.
- [ ] ID Tokens are correctly issued and validated.
- [ ] Two independent applications can use SSO.
- [ ] Each application maintains its own session.
- [ ] Application-specific authorization is enforced.
- [ ] Custom application services use Effect-TS.
- [ ] Typed errors and structured logs are implemented.
- [ ] Required unit, integration, and E2E tests pass.
- [ ] Docker deployment works.
- [ ] HTTPS is configured.
- [ ] Security requirements are verified.
- [ ] Documentation is complete.

---

## 21. Future Enhancements

After MVP completion, consider:

**Version 1.1 — Account and Session Management**

- Active session management UI
- Session revocation
- Account recovery improvements
- User security activity history

**Version 1.2 — Advanced Security**

- Multi-Factor Authentication
- Passkeys / WebAuthn
- Login anomaly detection
- More advanced rate limiting
- Device management

**Version 1.3 — Client Administration**

- Administrative client dashboard
- Client secret rotation workflows
- Client access policies
- Scope management

**Version 2.0 — Identity Platform**

- Organization and tenant management
- Centralized application entitlements
- Social identity providers
- Machine-to-machine OAuth clients
- Audited automated client provisioning
- Coordinated Single Logout
- Fine-grained authorization integration

---

## Final Architecture Decision

Build `book-auth-middleware` as a centralized OIDC Identity Provider using:

**Elysia.js + Better Auth + Effect-TS + Drizzle ORM + PostgreSQL**

Use Elysia for HTTP, Better Auth for authentication and identity protocol operations, Effect for custom typed application logic, Drizzle for persistence, and PostgreSQL for durable identity storage.

Keep all consuming applications independently deployed, with local sessions and application-specific authorization.

The primary objective is to build a secure, standards-based, reusable authentication service—not a monolithic backend that couples all existing projects together.