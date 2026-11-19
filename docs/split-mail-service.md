# Book Auth — Environment-Based Email Delivery Specification

**Version:** 1.1.0  
**Status:** Ready for implementation; production deployment remains gated by controlled Resend verification  
**Repository:** `narinsak-u/book-auth-middleware`  
**Scope:** Email delivery infrastructure  
**Stack:** Bun, Elysia.js, Better Auth, Nodemailer, Mailpit, Resend, Docker Compose

---

## 1. Objective

Refactor Central Identity's existing transactional email implementation to use environment-specific email providers.

| Environment | Provider | Transport |
|---|---|---|
| Development | Mailpit | Local SMTP |
| Test-production (`TEST_PRODUCTION=true`) | Isolated Mailpit | Local SMTP |
| Production | Resend | HTTPS API |
| Unit tests | In-memory fake | No network |

Mailpit must never be used for real production email delivery. The test-production exception is restricted to the existing isolated local profile.

Resend must not be called during normal development or automated unit tests.

The implementation must preserve all existing authentication functionality.

### Primary requirements

- Email verification after registration.
- Password reset.
- Existing account recovery behavior.
- Central SSO authorization continuation.
- Existing Better Auth authentication tokens and sessions.
- Existing PostgreSQL database and user records.

---

## 2. Current Implementation

The current `apps/server/src/auth.ts` creates a Nodemailer transport directly.

```ts
const mailer = nodemailer.createTransport({
  host: required("SMTP_HOST"),
  port: smtpPort,
  // Existing SMTP configuration
});
```

Better Auth calls `mailer.sendMail()` from:

- `emailVerification.sendVerificationEmail`
- `emailAndPassword.sendResetPassword`

### Problems

1. Email transport configuration is coupled to authentication configuration.
2. Production currently requires SMTP environment variables.
3. Changing transports requires modifying the authentication module.
4. Provider failures must propagate without exposing credentials or authentication links.

### Desired result

Better Auth should depend only on a small `EmailService` send contract.

The underlying provider should be selected at application initialization.

---

## 3. Target Architecture

```text
                Better Auth
                    |
          +---------+---------+
          |                   |
          v                   v
   Verify Email         Reset Password
          |                   |
          +---------+---------+
                    |
                    v
               EmailService
                    |
          Environment Selector
                    |
             +------+------+
             |             |
             v             v
         Dev / test     Production
             |             |
             v             v
          Mailpit        Resend
          SMTP           HTTPS API
             |             |
             v             v
       Local inbox     User's inbox
       :8025 / :8026
```

### Design principles

- Better Auth owns authentication workflows, token generation, and the existing email subjects and text.
- EmailService owns delivery and propagates submission failures.
- The selected transport owns provider-specific calls.
- Environment configuration selects the transport at startup.
- Authentication logic must not import Resend or Nodemailer directly.

Do not introduce a microservice solely for sending email.

Keep the delivery code inside the existing Elysia server workspace.

---

## 4. Code Organization

Keep the delivery contract, provider selection, and Nodemailer/Resend transports inside the existing server workspace. One small module and its tests are sufficient; split files only if the implementation becomes harder to read. Do not add an Effect layer, template framework, error taxonomy, controller, database model, queue, or microservice for this change.

## 5. EmailService Contract

Define a small provider-independent send contract:

```ts
export interface EmailService {
  send(input: { to: string; subject: string; text: string }): Promise<void>;
}
```

Both existing Better Auth callbacks already compose their plain-text messages. Keep their subjects and bodies unchanged. Delivery is awaited and submission failures propagate; the email service does not generate or validate tokens. HTML, idempotency keys, and reusable templates are not needed for this change.

## 6. Provider Selection

Use an explicit configuration variable:

```dotenv
EMAIL_PROVIDER=mailpit
```

Supported values:

```text
mailpit
resend
```

### Rules

| Runtime profile | Required `EMAIL_PROVIDER` | Required delivery settings |
|---|---|---|
| `NODE_ENV=development` | `mailpit` | `SMTP_HOST`, `SMTP_PORT`, `EMAIL_FROM` |
| `NODE_ENV=production`, `TEST_PRODUCTION=true` | `mailpit` | `SMTP_HOST`, `SMTP_PORT`, `EMAIL_FROM`; isolated Mailpit and operator-controlled test accounts |
| `NODE_ENV=production`, `TEST_PRODUCTION` unset or `false` | `resend` | `RESEND_API_KEY`, `EMAIL_FROM` on a verified domain |

Explicitly reject missing or mismatched providers at startup. In particular, real production must reject Mailpit. Development and test-production must not require a Resend key; real production must not require SMTP settings.

The test-production exception applies only to the existing isolated local HTTPS profile. Keep its existing issuer, database, credentials, callbacks, loopback bindings, and test Mailpit. Use only operator-controlled test accounts; do not claim that provider selection alone restricts recipients. Never set `TEST_PRODUCTION=true` as a workaround on a real production deployment.

Validate presence and shape of relevant settings at startup using the project's existing configuration style. A nonempty Resend key or plausible sender cannot prove API access or domain verification; verify those through a controlled send before production cutover. Never silently fall back to another provider.

---

## 7. Development Provider — Mailpit

### 7.1 Requirements

Preserve the existing Docker Compose service:

```yaml
mailpit:
  image: axllent/mailpit:v1.27.8
  ports:
    - "127.0.0.1:8025:8025"
  expose:
    - "1025"
```

Use Nodemailer as the SMTP adapter.

### 7.2 Development Configuration

```dotenv
NODE_ENV=development
EMAIL_PROVIDER=mailpit

SMTP_HOST=mailpit
SMTP_PORT=1025
EMAIL_FROM="Central Identity <identity@localhost>"
```

### 7.3 Mailpit Adapter

The transport must send the existing plain-text messages through the configured SMTP host, without SMTP authentication or production TLS requirements. Propagate SMTP errors. For Bun-hosted development, preserve `scripts/dev.ts` rewriting `SMTP_HOST=mailpit` to `127.0.0.1`; Compose uses the `mailpit` hostname. Do not call Resend.

Local emails must appear at:

```text
http://localhost:8025
```

Do not send development emails to Resend.

---

## 8. Production Provider — Resend

### 8.1 Requirements

Use the official `resend` npm package.

Install it in the server workspace:

```bash
bun add resend --filter @central-identity/server
```

Confirm the appropriate package-manager workspace syntax before running the command.

Resend should be accessed from server-side code only.

### 8.2 Production Configuration

```dotenv
NODE_ENV=production
EMAIL_PROVIDER=resend

RESEND_API_KEY=<secret>
EMAIL_FROM="Central Identity <auth@example.com>"
```

`auth@example.com` is a placeholder.

Replace it with an address on a domain verified in Resend.

### 8.3 Domain Verification

Before production deployment:

1. Create a Resend account.
2. Add an owned sending domain or suitable email subdomain.
3. Configure Resend's required DNS records.
4. Complete domain verification.
5. Configure SPF and DKIM according to Resend's instructions.
6. Configure DMARC appropriately.
7. Generate a sending API key with the minimum required permissions.
8. Store the key in encrypted production environment configuration or the deployment secret manager.

Never commit the plaintext API key.

Do not use a shared test sender for production authentication emails.

### 8.4 Resend Adapter

Implementation concept:

```ts
import { Resend } from "resend";

const resend = new Resend(config.apiKey);

const { data, error } = await resend.emails.send({
  from: config.from,
  to: [input.to],
  subject: input.subject,
  text: input.text,
});

if (error || !data?.id) {
  throw new Error("Email delivery failed");
}
```

This is an implementation sketch; use the installed SDK's actual supported types and response handling.

The adapter must:

- Use the official Resend SDK.
- Return success only when Resend accepts the email request.
- Check the returned error, not merely whether the call throws.
- Use a configured sender address.
- Avoid exposing API errors to end users.
- Never log API keys or authentication URLs.

An accepted request does not guarantee final inbox delivery.

---

## 9. Better Auth Integration

Remove direct Nodemailer usage from `apps/server/src/auth.ts`.

Create the configured EmailService during application initialization.

### Email verification

```ts
emailVerification: {
  sendOnSignUp: true,

  sendVerificationEmail: async ({ user, url }) => {
    await emailService.send({
      to: user.email,
      subject: "Verify your Central Identity email",
      text: `Verify your email address: ${url}`,
    });
  },
}
```

### Password reset

```ts
emailAndPassword: {
  enabled: true,
  requireEmailVerification: true,
  revokeSessionsOnPasswordReset: true,
  resetPasswordTokenExpiresIn: 60 * 60,

  sendResetPassword: async ({ user, url }) => {
    await emailService.send({
      to: user.email,
      subject: "Reset your Central Identity password",
      text: `Reset your password using this one-time link: ${url}`,
    });
  },
}
```

These examples show the intended integration and must be reconciled with the repository's existing auth configuration.

### Preserve existing behavior

Do not change:

- Verification token generation.
- Password reset token generation.
- Token expiration.
- Session revocation after password reset.
- Email verification requirements.
- User registration rules.
- OIDC client registration.
- Central Identity sessions.
- RP session creation.
- Authentication redirect continuation.

---

## 10. Email Content

Preserve the existing plain-text subjects and bodies in the Better Auth callbacks:

- Verification: `Verify your Central Identity email`; `Verify your email address: ${url}`.
- Reset: `Reset your Central Identity password`; `Reset your password using this one-time link: ${url}`.

Keep Better Auth's generated URLs, origin checks, token expiration, and redirect continuation unchanged. Do not log message bodies or authentication links. New HTML or reusable templates are outside this change.

## 11. Error Handling and Reliability

Await each submission in the existing Better Auth callback. Propagate Nodemailer failures and both Resend SDK errors and thrown exceptions. Return a generic error through the existing authentication flow without leaking provider details, addresses, API keys, or verification/reset links. Preserve the existing account-enumeration behavior for reset requests.

Do not add application-level retries in the initial implementation. An ambiguous timeout may already have been accepted by the provider; retrying could send duplicates. Do not add idempotency keys or a queue. If reliable retries are later required, specify a per-message key and delivery semantics separately.

Log only sanitized provider, email type, submission status, and a generic failure indicator if needed. Never log email content, authentication URLs or tokens, `RESEND_API_KEY`, or SMTP credentials. Resend acceptance is not proof of final inbox delivery.

## 12. Docker Compose Changes

### 12.1 Development

Keep Mailpit in `compose.yaml`. Update the `auth` service environment:

```yaml
auth:
  environment:
    EMAIL_PROVIDER: mailpit
    SMTP_HOST: mailpit
    SMTP_PORT: 1025
    EMAIL_FROM: ${EMAIL_FROM:-Central Identity <identity@localhost>}
```

Merge these values into the existing `auth` definition. Keep Mailpit's loopback UI and the existing `compose.bun.yaml` SMTP port for Bun-hosted development.

### 12.2 Production

Update `compose.identity.production.yaml`.

Remove obsolete SMTP requirements:

```text
SMTP_HOST
SMTP_PORT
SMTP_USER
SMTP_PASSWORD
SMTP_FROM
```

Replace them with:

```yaml
auth:
  environment:
    NODE_ENV: production
    EMAIL_PROVIDER: resend
    RESEND_API_KEY: ${RESEND_API_KEY:?RESEND_API_KEY is required}
    EMAIL_FROM: ${EMAIL_FROM:?EMAIL_FROM is required}
```

Preserve all existing unrelated production variables, networks, external database volume requirements, and health checks. The standalone production stack must not start, depend on, or expose Mailpit or SMTP.

### 12.3 Test-Production Isolation

Keep Mailpit in the existing `compose.yaml` + `compose.test-production.yaml` stack. Set `EMAIL_PROVIDER=mailpit` explicitly for `NODE_ENV=production`, `TEST_PRODUCTION=true`; keep the isolated Mailpit UI on `127.0.0.1:8026`. Do not use a Resend key or send to real users in this profile.

## 13. Environment and Secret Management

Use the existing dotenvx workflow.

### Development

```dotenv
EMAIL_PROVIDER=mailpit
EMAIL_FROM="Central Identity <identity@localhost>"
```

### Production

```dotenv
EMAIL_PROVIDER=resend
RESEND_API_KEY=<production-secret>
EMAIL_FROM="Central Identity <auth@example.com>"
```

### Requirements

- Keep `.env.development`, `.env.test-production`, and `.env.production` separate and encrypted with the existing dotenvx workflow.
- Migrate the encrypted development and test-production settings from `SMTP_FROM` to `EMAIL_FROM` while retaining their Mailpit host/port. Migrate production from SMTP settings to `RESEND_API_KEY` and `EMAIL_FROM` using the protected operator workflow; do not print, commit, or silently replace secrets.
- Update `.env.development.example`, `.env.test-production.example`, and `.env.identity.production.example` with matching nonsecret placeholders.
- Do not expose Resend credentials to TanStack Start/browser code or use a `VITE_` prefix for them.
- Validate the verified sender domain and actual API submission before cutover; startup checks alone cannot establish either.
- Update `scripts/identity-compose-smoke.sh` and the **new-provider** configuration in `scripts/cutover-rehearsal.sh`: they currently set synthetic production SMTP variables. Supply synthetic Resend configuration for startup-only checks without making outbound sends. Preserve the rehearsal's **legacy** SMTP configuration for its pre-cutover stack. The controlled real Resend send is a separate deployment gate.

---

## 14. Testing Strategy

### Unit Tests

Use an in-memory fake `EmailService`. Verify recipient, existing subject/text and generated URL, propagation of submission failures, and the environment matrix: development and test-production require Mailpit without a Resend key; real production requires Resend and rejects Mailpit. Test that Resend SDK `{ error }` and thrown failures do not expose details through the auth flow.

### Mailpit Integration Tests

Use the existing Mailpit API and Better Auth tests.

Validate:

1. Register a development account.
2. Verify a message appears in Mailpit.
3. Open the verification link.
4. Verify the account.
5. Request password reset.
6. Retrieve the reset email.
7. Reset the password.
8. Confirm the old session is revoked.
9. Confirm the new password works.

Preserve existing replay-token tests.

### Controlled Resend Verification

Before production cutover, use a separate protected verification environment, a verified sender domain, and operator-controlled recipients. Confirm API submission, message status, link validity, and generic handling of invalid-key/provider errors. Do not send production test emails to arbitrary real users. No retry, rate-limit-recovery, or idempotency behavior is required for the initial implementation.

### SSO Regression Tests

Run the existing cross-application authentication tests.

Verify that changes to email sending do not break:

- Book Bidding authentication.
- Read in Peace authentication.
- Central SSO session reuse.
- Independent RP sessions.
- Login continuation after account verification.
- Authentication after password recovery.

---

## 15. Implementation Plan

### Phase 1 — Select Transport

- Define the small send contract and validate the three runtime profiles at startup.
- Move Nodemailer out of `auth.ts`; preserve the existing email text in its Better Auth callbacks.
- Add the Resend SDK in the server workspace and implement one-attempt API submission with checked `{ error }` and thrown failures.

### Phase 2 — Wire Configuration

- Keep Mailpit for development and isolated test-production; require Resend for real production.
- Update both Compose profiles and the development, test-production, and production examples and encrypted runtime settings without changing OIDC, database volumes, or application sessions.
- Update `scripts/identity-compose-smoke.sh` and only the new-provider settings in `scripts/cutover-rehearsal.sh`; keep the rehearsal's legacy SMTP settings.

### Phase 3 — Verify

- Run focused provider-selection and transport tests, then existing Mailpit verification/reset tests and cross-application SSO checks.
- Check production fails fast on missing/mismatched settings; run synthetic startup checks without outbound mail.
- Before production cutover, verify the Resend sender domain, run controlled verification and reset sends, check their links and token behavior, and confirm no Mailpit fallback.
- Update `README.md`, environment examples, and deployment documentation.

## 16. Acceptance Criteria

### Development

- [ ] Mailpit remains the only local email provider.
- [ ] `bun run dev` starts without a Resend API key.
- [ ] Verification emails appear in Mailpit.
- [ ] Password reset emails appear in Mailpit.
- [ ] Existing authentication tests pass.

### Test-Production

- [ ] `NODE_ENV=production`, `TEST_PRODUCTION=true` uses only its isolated Mailpit and test recipients.
- [ ] It requires no Resend API key and retains its separate HTTPS issuer, callbacks, credentials, and database.

### Production

- [ ] Real production uses the Resend SDK and requires `RESEND_API_KEY` and a configured sender.
- [ ] Real production never uses SMTP or Mailpit; missing/mismatched provider configuration prevents startup.
- [ ] Resend errors are handled without leaking secrets or authentication links.
- [ ] A controlled verification email and password reset email are accepted from the verified sender and their links work.
- [ ] Existing synthetic production startup and cutover rehearsals work without outbound email.

### Architecture

- [ ] `EmailService` has a small send interface, selected at startup, and each transport is unit-testable.
- [ ] Better Auth does not import either provider directly.
- [ ] No new database schema, microservice, message broker, template system, Effect layer, or retry machinery is introduced.
- [ ] Existing authentication and SSO behavior is preserved.

### Security

- [ ] Production secrets remain server-side.
- [ ] Email tokens are never logged.
- [ ] Authentication callbacks remain trusted.
- [ ] Account enumeration protections are preserved.
- [ ] Provider failures do not leak sensitive details.
- [ ] Existing password reset expiration is preserved.

---

## 17. AI Coding Agent Instructions

Implement this specification in the existing `book-auth-middleware` repository.

### Instructions

1. Inspect `auth.ts`, all Compose profiles, encrypted environment workflows, and the existing smoke/rehearsal scripts.
2. Preserve verification, reset, SSO, issuer, callback, token, session, and database behavior.
3. Use Mailpit only for development and isolated test-production; use Resend only for real production.
4. Keep the send contract small, existing message text unchanged, and delivery awaited with no application-level retries.
5. Update development, test-production, and production configuration, both synthetic scripts, tests, and relevant docs.
6. Never expose secrets or authentication links to the browser or logs. Do not make outbound sends during synthetic checks.

### Expected Deliverables

- Small send contract and Mailpit/Resend transports in the server workspace.
- Startup provider selection and Better Auth integration.
- Development, test-production, and production Compose/environment updates.
- Updated standalone smoke and cutover rehearsal settings.
- Focused tests and updated onboarding/deployment documentation.

---

## 18. Definition of Done

Development and isolated test-production send verification and password-reset messages to their respective Mailpit inboxes without a Resend key. Real production requires Resend, a verified sender, and controlled successful verification/reset sends before cutover; it cannot use Mailpit or fall back to SMTP. Existing authentication and SSO behavior, user records, and database volumes remain unchanged.