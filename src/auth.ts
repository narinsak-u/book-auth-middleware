import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { oauthProvider } from "@better-auth/oauth-provider";
import { betterAuth } from "better-auth";
import { jwt } from "better-auth/plugins";
import nodemailer from "nodemailer";
import { db } from "./db";
import * as schema from "./schema";
const baseURL = process.env.BETTER_AUTH_URL ?? "https://auth.127.0.0.1.nip.io";
const biddingClientId = process.env.BIDDING_OIDC_CLIENT_ID;
const mailer = nodemailer.createTransport({
  host: process.env.SMTP_HOST ?? "localhost",
  port: Number(process.env.SMTP_PORT ?? 1025),
  secure: false,
});

export const auth = betterAuth({
  appName: "Central Identity",
  baseURL,
  secret: process.env.BETTER_AUTH_SECRET ?? "local-only-secret-change-before-deployment-32chars",
  trustedOrigins: [baseURL],
  database: drizzleAdapter(db, { provider: "pg", schema }),
  advanced: { useSecureCookies: true },
  session: { expiresIn: 7 * 24 * 60 * 60 },
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true,
    revokeSessionsOnPasswordReset: true,
    resetPasswordTokenExpiresIn: 60 * 60,
    sendResetPassword: async ({ user, url }) => {
      mailer.sendMail({
        from: process.env.SMTP_FROM ?? "Central Identity <identity@localhost>",
        to: user.email,
        subject: "Reset your Central Identity password",
        text: `Reset your password using this one-time link: ${url}`,
      }, (error) => {
        if (error) {
          console.error(JSON.stringify({ event: "email.delivery.failure", action: "password_reset" }));
        }
      });
    },
  },
  emailVerification: {
    sendOnSignUp: true,
    sendVerificationEmail: async ({ user, url }) => {
      await mailer.sendMail({
        from: process.env.SMTP_FROM ?? "Central Identity <identity@localhost>",
        to: user.email,
        subject: "Verify your Central Identity email",
        text: `Verify your email address: ${url}`,
      });
    },
  },
  plugins: [
    jwt(),
    oauthProvider({
      loginPage: "/",
      scopes: ["openid", "email", "profile"],
      cachedTrustedClients: new Set(biddingClientId ? [biddingClientId] : []),
      clientPrivileges: async () => false,
    }),
  ],
});
