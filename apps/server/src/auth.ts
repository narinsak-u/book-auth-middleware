import { APIError, createAuthMiddleware } from "better-auth/api";
import { createHash } from "node:crypto";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { oauthProvider } from "@better-auth/oauth-provider";
import { betterAuth, getCurrentAdapter } from "better-auth";
import { jwt, username } from "better-auth/plugins";
import nodemailer from "nodemailer";
import { db } from "@central-identity/db";
import * as schema from "@central-identity/db/schema";
import { allowCredentialSignup } from "./enrollment-invitation";
import { allowedOAuthCallback } from "./provision-oauth-client";
const required = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
};
const production = process.env.NODE_ENV === "production";
const testProduction = production && process.env.TEST_PRODUCTION === "true";
const oauthEnabled = !production || testProduction;
const productionRuntime = production && !testProduction;
const baseURL = production
  ? required("BETTER_AUTH_URL")
  : process.env.BETTER_AUTH_URL ?? "https://auth.localhost:8080";
const authSecret = production
  ? required("BETTER_AUTH_SECRET")
  : process.env.BETTER_AUTH_SECRET ?? "local-only-secret-change-before-deployment-32chars";
if (production) {
  if (baseURL !== `https://${required("AUTH_DOMAIN")}`) {
    throw new Error("BETTER_AUTH_URL must match https://AUTH_DOMAIN");
  }
  required("DATABASE_URL");
}
const googleClientId = oauthEnabled ? required("GOOGLE_CLIENT_ID") : undefined;
const googleClientSecret = oauthEnabled ? required("GOOGLE_CLIENT_SECRET") : undefined;
const githubClientId = oauthEnabled ? required("GITHUB_CLIENT_ID") : undefined;
const githubClientSecret = oauthEnabled ? required("GITHUB_CLIENT_SECRET") : undefined;
const smtpPort = Number(required("SMTP_PORT"));
if (!Number.isInteger(smtpPort) || smtpPort < 1 || smtpPort > 65535) {
  throw new Error("SMTP_PORT must be a valid TCP port");
}
const mailer = nodemailer.createTransport({
  host: required("SMTP_HOST"),
  port: smtpPort,
  secure: smtpPort === 465,
  requireTLS: productionRuntime && smtpPort !== 465,
  ...(productionRuntime ? {
    auth: { user: required("SMTP_USER"), pass: required("SMTP_PASSWORD") },
  } : {}),
});

export const auth = betterAuth({
  appName: "Central Identity",
  baseURL,
  secret: authSecret,
  trustedOrigins: [baseURL],
  database: drizzleAdapter(db, { provider: "pg", schema }),
  advanced: { useSecureCookies: true },
  session: { expiresIn: 7 * 24 * 60 * 60 },
  rateLimit: {
    enabled: true,
    window: 60,
    max: 10,
    customRules: {
      "/sign-up/email": { window: 60, max: 5 },
      "/sign-in/email": { window: 60, max: 5 },
      "/sign-in/username": { window: 60, max: 5 },
    },
  },
  databaseHooks: {
    user: {
      create: {
        before: async (newUser, endpoint) => {
          const path = endpoint?.request && new URL(endpoint.request.url).pathname;
          if (path === "/api/auth/sign-up/email") {
            return allowCredentialSignup({
              productionRuntime,
              newUser,
              invitationToken: endpoint?.request?.headers.get("x-enrollment-invitation"),
              consumeInvitation: async (token, email) => {
                const adapter = await getCurrentAdapter(endpoint!.context.adapter);
                const now = new Date();
                const invitation = await adapter.update({
                  model: "enrollmentInvitation",
                  where: [
                    { field: "tokenHash", value: createHash("sha256").update(token).digest("hex") },
                    { field: "email", value: email.trim().toLowerCase() },
                    { field: "expiresAt", operator: "gt", value: now },
                    { field: "consumedAt", value: null },
                  ],
                  update: { consumedAt: now },
                });
                return Boolean(invitation);
              },
            });
          }
          if (newUser.email && newUser.emailVerified) return;
          return false;
        },
      },
    },
  },
  ...(oauthEnabled ? {
    account: { accountLinking: { enabled: true, disableImplicitLinking: true, allowDifferentEmails: true } },
  } : {}),
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true,
    revokeSessionsOnPasswordReset: true,
    resetPasswordTokenExpiresIn: 60 * 60,
    sendResetPassword: async ({ user, url }) => {
      await mailer.sendMail({
        from: required("SMTP_FROM"),
        to: user.email,
        subject: "Reset your Central Identity password",
        text: `Reset your password using this one-time link: ${url}`,
      });
    },
  },
  emailVerification: {
    sendOnSignUp: true,
    sendVerificationEmail: async ({ user, url }) => {
      await mailer.sendMail({
        from: required("SMTP_FROM"),
        to: user.email,
        subject: "Verify your Central Identity email",
        text: `Verify your email address: ${url}`,
      });
    },
  },
  socialProviders: {
    ...(oauthEnabled && googleClientId && googleClientSecret ? {
      google: { clientId: googleClientId, clientSecret: googleClientSecret },
    } : {}),
    ...(oauthEnabled && githubClientId && githubClientSecret ? {
      github: {
        clientId: githubClientId,
        clientSecret: githubClientSecret,
        scope: ["read:user", "user:email"],
      },
    } : {}),
  },
  plugins: [
    jwt(),
    {
      id: "approved-oauth-clients",
      hooks: {
        before: [{
          matcher: ({ path }) => path === "/oauth2/authorize" || path === "/oauth2/token",
          handler: createAuthMiddleware(async (ctx) => {
            const authorization = ctx.headers?.get("authorization");
            let basicClientId: string | undefined;
            if (authorization?.split(/\s+/, 1)[0].toLowerCase() === "basic") {
              try {
                const encodedCredentials = authorization.match(/^Basic\s+([A-Za-z0-9+/]+={0,2})$/i)?.[1];
                if (!encodedCredentials) throw new Error("Invalid Basic credentials");
                const credentials = atob(encodedCredentials);
                const separator = credentials.indexOf(":");
                if (separator < 0) throw new Error("Invalid Basic credentials");
                basicClientId = new URLSearchParams(`client_id=${credentials.slice(0, separator)}`).get("client_id") || undefined;
                if (!basicClientId) throw new Error("Invalid Basic credentials");
              } catch {
                throw new APIError("UNAUTHORIZED", { message: "OAuth client credentials are invalid" });
              }
            }
            const isTokenRequest = ctx.path === "/oauth2/token";
            const formClientId = isTokenRequest ? ctx.body?.client_id : undefined;
            if (basicClientId && formClientId !== undefined && formClientId !== basicClientId) {
              throw new APIError("UNAUTHORIZED", { message: "OAuth client credentials are invalid" });
            }
            const clientId = isTokenRequest
              ? basicClientId ?? formClientId
              : ctx.query?.client_id ?? ctx.body?.client_id ?? basicClientId;
            if (typeof clientId !== "string") return;
            const client = await ctx.context.adapter.findOne<{
              disabled: boolean | null;
              skipConsent: boolean | null;
            }>({
              model: "oauthClient",
              where: [{ field: "clientId", value: clientId }],
            });
            if (!client || client.disabled || client.skipConsent !== true) {
              throw new APIError("UNAUTHORIZED", { message: "OAuth client is not approved" });
            }
          }),
        }],
      },
    },
    oauthProvider({
      loginPage: "/sign-in",
      consentPage: "/oauth/consent",
      scopes: ["openid", "email", "profile"],
      // Native loopback defaults allow any port; these RPs require exact registered callbacks.
      validateRedirectUri: (uri, registeredUris) =>
        registeredUris.includes(uri) && allowedOAuthCallback(new URL(uri)),
      clientPrivileges: async ({ action }) =>
        action === "create" && process.env.OIDC_CLIENT_PROVISIONING === "true",
    }),
    username({
      minUsernameLength: 3,
      maxUsernameLength: 30,
      usernameValidator: (value) => {
        const normalized = value.toLowerCase();
        return /^[a-z0-9_]+$/.test(normalized) &&
          !["admin", "api", "auth", "root", "support", "www"].includes(normalized);
      },
    }),
  ],
});
