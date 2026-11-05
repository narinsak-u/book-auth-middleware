import { createHash } from "node:crypto";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { oauthProvider } from "@better-auth/oauth-provider";
import { betterAuth, getCurrentAdapter } from "better-auth";
import { jwt } from "better-auth/plugins";
import nodemailer from "nodemailer";
import { db } from "@central-identity/db";
import * as schema from "@central-identity/db/schema";
const required = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
};
const production = process.env.NODE_ENV === "production";
const baseURL = production
  ? required("BETTER_AUTH_URL")
  : process.env.BETTER_AUTH_URL ?? "https://auth.127.0.0.1.nip.io";
const authSecret = production
  ? required("BETTER_AUTH_SECRET")
  : process.env.BETTER_AUTH_SECRET ?? "local-only-secret-change-before-deployment-32chars";
if (production) {
  if (baseURL !== `https://${required("AUTH_DOMAIN")}`) {
    throw new Error("BETTER_AUTH_URL must match https://AUTH_DOMAIN");
  }
  required("DATABASE_URL");
}
const biddingClientId = process.env.BIDDING_OIDC_CLIENT_ID;
const readingClientId = process.env.READING_OIDC_CLIENT_ID;
const smtpHost = production ? required("SMTP_HOST") : process.env.SMTP_HOST ?? "localhost";
const smtpPort = Number(production ? required("SMTP_PORT") : process.env.SMTP_PORT ?? 1025);
const smtpFrom = production ? required("SMTP_FROM") : process.env.SMTP_FROM ?? "Central Identity <identity@localhost>";
if (!Number.isInteger(smtpPort) || smtpPort < 1 || smtpPort > 65535) {
  throw new Error("SMTP_PORT must be a valid TCP port");
}
const mailer = nodemailer.createTransport({
  host: smtpHost,
  port: smtpPort,
  secure: smtpPort === 465,
  ...(production ? { requireTLS: smtpPort !== 465, auth: {
    user: required("SMTP_USER"),
    pass: required("SMTP_PASSWORD"),
  } } : {}),
});

export const auth = betterAuth({
  appName: "Central Identity",
  baseURL,
  secret: authSecret,
  trustedOrigins: [baseURL],
  database: drizzleAdapter(db, { provider: "pg", schema }),
  advanced: { useSecureCookies: true },
  session: { expiresIn: 7 * 24 * 60 * 60 },
  databaseHooks: {
    user: {
      create: {
        before: async (newUser, endpoint) => {
          const request = endpoint?.request;
          if (!request || new URL(request.url).pathname !== "/api/auth/sign-up/email") return;
          const token = request.headers.get("x-enrollment-invitation");
          if (!token || typeof newUser.email !== "string") return false;

          const now = new Date();
          const adapter = await getCurrentAdapter(endpoint.context.adapter);
          const invitation = await adapter.update({
            model: "enrollmentInvitation",
            where: [
              { field: "tokenHash", value: createHash("sha256").update(token).digest("hex") },
              { field: "email", value: newUser.email.trim().toLowerCase() },
              { field: "expiresAt", operator: "gt", value: now },
              { field: "consumedAt", value: null },
            ],
            update: { consumedAt: now },
          });
          if (!invitation) return false;
        },
      },
    },
  },
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true,
    revokeSessionsOnPasswordReset: true,
    resetPasswordTokenExpiresIn: 60 * 60,
    sendResetPassword: async ({ user, url }) => {
      await mailer.sendMail({
        from: smtpFrom,
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
        from: smtpFrom,
        to: user.email,
        subject: "Verify your Central Identity email",
        text: `Verify your email address: ${url}`,
      });
    },
  },
  plugins: [
    jwt(),
    oauthProvider({
      loginPage: "/sign-in",
      consentPage: "/oauth/consent",
      scopes: ["openid", "email", "profile"],
      cachedTrustedClients: new Set([biddingClientId, readingClientId].filter((id): id is string => Boolean(id))),
      clientPrivileges: async ({ action }) =>
        action === "create" && process.env.BIDDING_OIDC_PROVISIONING === "true",
    }),
  ],
});
