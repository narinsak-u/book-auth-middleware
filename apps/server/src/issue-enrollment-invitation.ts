import { randomBytes, createHash, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import nodemailer from "nodemailer";
import { closeDatabase, db, user } from "@central-identity/db";
import { enrollmentInvitation } from "@central-identity/db/schema";

try {
  const email = process.argv[2]?.trim().toLowerCase();
  if (process.env.NODE_ENV !== "production" || process.env.TEST_PRODUCTION === "true") {
    throw new Error("Invitation enrollment is disabled outside live production.");
  }
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("Usage: bun run issue:enrollment-invitation <email>");
  }
  if ((await db.select({ id: user.id }).from(user).where(eq(user.email, email)).limit(1)).length) {
    throw new Error("That address already has a Central Identity");
  }

  const production = process.env.NODE_ENV === "production";
  const host = production ? process.env.SMTP_HOST : process.env.SMTP_HOST ?? "localhost";
  const port = Number(production ? process.env.SMTP_PORT : process.env.SMTP_PORT ?? 1025);
  const from = production ? process.env.SMTP_FROM : process.env.SMTP_FROM ?? "Central Identity <identity@localhost>";
  const baseURL = production ? process.env.BETTER_AUTH_URL : process.env.BETTER_AUTH_URL ?? "https://auth.127.0.0.1.nip.io";
  if (!host || !from || !baseURL || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("SMTP and BETTER_AUTH_URL settings are required");
  }
  if (production && (!process.env.SMTP_USER || !process.env.SMTP_PASSWORD)) {
    throw new Error("Production SMTP credentials are required");
  }
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const token = randomBytes(32).toString("base64url");
  const id = randomUUID();
  await db.insert(enrollmentInvitation).values({
    id,
    email,
    tokenHash: createHash("sha256").update(token).digest("hex"),
    expiresAt,
  });
  const url = new URL("/sign-up", baseURL);
  url.searchParams.set("invitation", token);
  try {
    await nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      ...(production ? {
        requireTLS: port !== 465,
        auth: { user: process.env.SMTP_USER!, pass: process.env.SMTP_PASSWORD! },
      } : {}),
    }).sendMail({
      from,
      to: email,
      subject: "Your Central Identity invitation",
      text: `Create your Central Identity using this invitation: ${url.toString()}\nThis invitation expires in seven days and can be used once.`,
    });
    console.info("Enrollment invitation sent.");
  } catch {
    await db.delete(enrollmentInvitation).where(eq(enrollmentInvitation.id, id));
    console.error("Invitation delivery failed; no invitation remains active.");
    process.exitCode = 1;
  }
} finally {
  await closeDatabase();
}
