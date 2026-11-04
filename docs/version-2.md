# Central Identity — Authentication Portal v2

**Status:** agreed design; not yet implemented  
**Scope:** migrate this repository's provider and add its Authentication Portal; keep Book Bidding and Read in Peace independently deployed  
**First delivery:** working local HTTPS integration, not a production deployment

## 1. Goal and existing baseline

A person signs into Central Identity once, then enters Book Bidding and Read in Peace through OIDC without entering credentials again. Each Relying Party creates and owns its own Application User, Identity Link, Application Session, and access rules. Signing out of one Application Session does not end the others or the Central SSO Session.

This is an evolution of the existing working integration, not a new identity system. The provider already runs Elysia, Better Auth's OAuth Provider, PostgreSQL, and Drizzle. It already supports verified email/password enrollment, password recovery, operator-managed OIDC clients, a Central SSO Session, issuer discovery/JWKS, and a minimal Elysia-served login page. The two real Relying Parties already have OIDC integrations and independent sessions. Preserve their existing users, links, login methods, and authorization behavior.

Version 2 replaces the inline provider page with a dedicated TanStack Start Authentication Portal and moves the provider into a Bun Workspaces/Turborepo layout. Effect is limited to useful custom operator workflows; Better Auth remains responsible for authentication and protocol handling. Do not build two substitute demo applications.

**Primary success criterion:** A person visits a protected page in Book Bidding, authenticates through the Authentication Portal, and returns to that page. With the Central SSO Session still valid, the person visits a protected page in Read in Peace, skips the password form, and returns to that page. Both Application Sessions remain independent.

## 2. Boundaries and layout

```text
book-auth-middleware/          # provider repository only
├── apps/
│   ├── web/                    # TanStack Start + React 19 Authentication Portal
│   └── server/                 # Elysia + Better Auth OAuth Provider
├── packages/
│   ├── db/                     # existing Drizzle schema, migration history, connection
│   └── typescript-config/      # shared strict TypeScript settings where useful
├── infrastructure/             # local Compose, Caddy, service build definitions
├── turbo.json
├── package.json                # Bun workspaces and Turbo tasks
└── bun.lock

../book-bidding/                # existing SvelteKit Relying Party; separate repository
../read-in-peace/              # existing Nuxt + NestJS Relying Party; separate repository
```

Use Bun for workspace dependency management and the provider's web/server processes, with compatible pinned versions and one committed lockfile. Turborepo runs the workspace's existing build, typecheck, and test tasks; do not add unused packages or a provider-specific auth-client SDK for independent Relying Parties. Keep Better Auth's supported OIDC protocol as the integration contract, not internal provider imports. Each Relying Party retains its own package manager, database, and deployment.

The portal and Elysia server run as **separate processes** behind one public origin. The local public origin remains `https://auth.127.0.0.1.nip.io`. Caddy routes the portal's `/`, `/sign-in`, `/sign-up`, `/forgot-password`, and `/reset-password` to the web process; `/api/auth/*`, actual OAuth/OIDC metadata paths, and `/health/*` to the Elysia process. Match the discovery and metadata paths emitted by the installed Better Auth version; do not let the web fallback capture them. Proxy routing must preserve callback Location and Set-Cookie headers. Verify TanStack Start's supported Bun build/serving setup against its current documentation before implementation.

The canonical issuer remains `https://auth.127.0.0.1.nip.io/api/auth`; existing discovery is at `/api/auth/.well-known/openid-configuration`. Moving code or changing the portal route must not change the issuer or the public OIDC endpoints.

## 3. Authentication Portal

| Route | Behavior |
| --- | --- |
| `/` | Redirect to `/sign-in` when anonymous; show minimal authenticated Central Identity state and central sign-out when signed in. |
| `/sign-in` | Email/password sign-in with accessible fields, pending state, useful failure messages, recovery link, and enrollment link. |
| `/sign-up` | Email-verified self-registration for this **local proof**; explain that email verification is required before password sign-in. |
| `/forgot-password` | Request a reset link with the same public confirmation whether or not the address exists. |
| `/reset-password` | Accept Better Auth's one-time reset link, set a new password, and handle expired or reused links. |

Use Better Auth's browser client and existing server endpoints, not a new credential store or custom auth API. Keep the interface focused on authentication; there is no application launcher, admin dashboard, OAuth client UI, or consent screen in this delivery.

When a Relying Party initiates authorization, Better Auth must send the person to `/sign-in` if needed. Preserve the provider-issued authorization context *as issued* through sign-in and resume authorization through the supported Better Auth flow; do not construct a replacement OAuth request, copy tokens into browser URLs, or trust a caller-supplied callback destination. A valid Central SSO Session skips password entry. Direct visits to the portal have no originating Relying Party and remain on a safe provider-local page after sign-in. The portal must not treat a signed-in Central Identity as proof of access to either Relying Party.

Sign-out from the Authentication Portal terminates only the Central SSO Session. Explain in the UI that existing Book Bidding and Read in Peace Application Sessions continue until each application ends them or they expire. Preserve existing email verification, one-time password reset, and operator-disabled identity behavior. Mailpit and the current test mailbox are local-only.

## 4. Provider and data continuity

Elysia continues to mount Better Auth and expose liveness/readiness. Better Auth remains the sole owner of email/password sessions, verification/reset tokens, the OAuth authorization/token endpoints, signing keys, discovery/JWKS, and OIDC client authorization. Drizzle retains the existing PostgreSQL schema and committed migration history; move files and scripts without regenerating or replaying initial schema against populated data. Use a dedicated migration command or one-shot service before starting the new server; fail closed on migration errors.

Preserve the existing database volume and records: Central Identities, credential hashes, Central SSO Sessions, OAuth clients, consent/trust configuration, signing material, codes, and migration journal. Keep the Better Auth secret, cookie scope/security settings, public origin, issuer, client IDs/secrets, and callback URIs stable. Migration is not permission to reset local proof data, reprovision clients, rotate secrets, or change subject identifiers. Take a restorable backup before applying any new migration; prove sign-in, issuer continuity, and existing client credentials against the migrated instance. An intentional future key or client rotation requires its own plan.

Effect may structure custom operator-only client provisioning and Central Identity disable workflows when it improves their error handling/resource cleanup. Do not wrap every Better Auth call or add unused Context/Layer hierarchies, custom user/audit tables, or a second authentication engine. Preserve the current limited structured authentication event logging without exposing email addresses, passwords, tokens, authorization codes, raw redirect URLs, or cookies.

Disable must prevent a Central Identity from starting new OIDC authorization, revoke its Central SSO Sessions, and invalidate its outstanding authorization codes; it does not revoke existing Application Sessions. Provisioning stays an operator-only CLI using Better Auth's supported client API: no public dynamic registration, no ordinary-user client creation, no client-management UI. The migration must also carry both trusted client IDs into the server's configuration; currently only Book Bidding's ID is passed by Compose, so the new service must not drop Read in Peace's trusted-client status.

## 5. Relying-Party contracts

| Relying Party | Public callback | Ownership |
| --- | --- | --- |
| Book Bidding | `https://bidding.127.0.0.1.sslip.io/api/auth/callback/central-identity` | SvelteKit and its own Application Users, Identity Links, database, sessions, and authorization. |
| Read in Peace | `https://reading.lvh.me/api/auth/callback/central-identity` | Nuxt/NestJS and its own Application Users, Identity Links, database, sessions, and authorization. |

Keep both existing confidential first-party registrations: exact callback URI, authorization code, PKCE S256, `client_secret_basic`, and `openid email profile` scopes. Both explicitly skip consent; unregistered clients are rejected. This delivery does **not** support a third-party client that requires consent. Do not claim universal consent skipping or silently approve a client that was not provisioned as trusted. Retain the existing local-session-first login behavior, independent local sign-out, and explicit proof-of-both-accounts Identity Links. Matching email addresses never link an existing Application User to a Central Identity (ADR 0001).

Each Relying Party owns the path the person originally requested. Before starting OIDC, it retains a safe application-local destination alongside its authorization transaction. After validating the callback (`state`, PKCE, expected issuer/audience/signature/expiry, nonce where applicable), it establishes an Application Session and returns only to that validated destination. Distinguish the **registered OIDC callback URI** from the **original protected page**; neither the provider nor an untrusted query value chooses an arbitrary redirect. Fall back to the application's normal landing page only for a direct sign-in without an original destination.

This requires targeted changes in the existing Relying Parties: Book Bidding currently sends Central Identity sign-ins to `/dashboard` even if the login URL has a `next` destination; Read in Peace currently sends them to its origin. Make the original-page path work in both without changing their independent deployment or authorization boundaries. A Central Identity alone grants no Book Bidding or Read in Peace permissions.

## 6. Local topology and safety

Run PostgreSQL, Mailpit, the Elysia server, TanStack Start, and Caddy together in the provider's local Compose environment; keep the existing separate local HTTPS hosts for Book Bidding and Read in Peace. Expose the browser-facing services through Caddy with a single Central Identity origin and current local CA trust instructions. Keep PostgreSQL private. Use ignored environment files for secrets; never put client secrets into the portal build or browser responses. The trusted client ID is public configuration, but its secret is private to its Relying Party.

Keep the present baseline security properties throughout the migration: Secure/HttpOnly host-only provider cookies; browser CSRF/origin protections for cookie-authenticated writes; exact registered redirects; `state`, PKCE S256, and ID token validation by each Relying Party; no ID/access tokens in redirect URLs; no open redirects; no shared authentication cookie across application hosts. An untrusted proxy header must not alter the issuer or redirect origin. Keep sign-in, signup, and password-reset endpoints local-only until abuse controls and production email are in place.

**Not a production deployment:** do not promote the example secrets, Mailpit, open enrollment, or local CA as production settings. A later production plan must cover real email, abuse/rate limiting, environment and proxy validation, key/secret management, backups/restore, migrations, observability, and deployment/rollback. Do not imply those controls are delivered merely because the local end-to-end proof works.

## 7. Implementation and verification

Implement in releasable increments, keeping the existing provider usable until the portal cutover:

1. Create Bun workspaces/Turborepo around the existing server and database code. Move schema and migration history without renaming persisted identities, keys, issuer, or clients. Verify existing provider HTTP tests against the preserved PostgreSQL volume.
2. Add TanStack Start routes and connect them to existing Better Auth endpoints. Verify direct enrollment, email verification, sign-in persistence, recovery, sign-out, and a browser-initiated authorization that resumes after sign-in. Remove the old inline page at cutover rather than maintaining two login interfaces.
3. Route both processes under the existing HTTPS origin, with protocol endpoints exclusively reaching Elysia. Prove discovery/JWKS, callback redirects, cookies, health, and post-restart sessions through Caddy.
4. Restore original protected-page destinations in Book Bidding and Read in Peace. Run the live cross-origin browser flow through the real Relying Parties, and preserve their existing local authentication methods and Identity Links.

Tests should exercise observable HTTP/browser behavior at the highest practical seam, not re-test framework wiring. Reuse the existing provider HTTP suite and both applications' opt-in live OIDC/browser tests, updating selectors that referred to the removed inline page. Cover at least:

- First verified Central Identity sign-in from each application's protected page, returning to **that page**, not just the application root.
- A preexisting Central SSO Session allowing entry to the other application without showing a password form; each creates an independent Application Session.
- Direct portal sign-in with no OIDC request; local recovery with an unknown address, an expired/reused token, and successful login with the replacement password.
- Incorrect issuer/redirect, unknown client, mismatched state, failed PKCE, reused code, and hostile original destination rejected without login or open redirect.
- Existing OAuth clients and Central Identities still working after migration/restart, with issuer/discovery and verification behavior unchanged.
- Central sign-out preventing fresh silent SSO without ending either existing Application Session; local sign-out ending only that application's session.
- An authenticated Central Identity with no Relying Party permission being denied by that application's authorization, and an existing same-email Application User never being auto-linked.
- Operator disable rejecting fresh authorization and previously issued code exchange while leaving already-established Application Sessions intact.

## 8. Acceptance criteria

- [ ] Bun Workspaces and Turborepo run the provider's web/server build, typecheck, and tests without moving the Relying Parties into the repo.
- [ ] TanStack Start provides accessible sign-in, sign-up, recovery/reset, authenticated state, and central sign-out pages; Elysia hosts Better Auth in a separate process.
- [ ] PostgreSQL records, Drizzle migration history, existing Central Identities, issuer, signing keys, and both client registrations remain usable across cutover.
- [ ] Caddy sends portal routes to web and actual Better Auth protocol, discovery/JWKS, and health routes to server under the unchanged HTTPS origin.
- [ ] A first sign-in returns to the original protected Book Bidding page; the same Central SSO Session skips password entry in Read in Peace and returns to its original protected page.
- [ ] Each Relying Party owns its Application Session and authorization; no email-only Identity Link or implicit global logout occurs.
- [ ] Unknown clients, unregistered redirects, invalid callback state/PKCE, code replay, and untrusted destination redirects fail safely.
- [ ] Existing local provider HTTP tests and both real Relying Parties' live browser SSO tests pass against the migrated stack.
- [ ] No additional demo apps, consent page for unsupported clients, launcher, admin/client-management UI, or production-readiness claim is introduced.
