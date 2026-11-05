import { randomUUID } from "node:crypto";
import { closeDatabase, db, user } from "@central-identity/db";
import { account } from "@central-identity/db/schema";
import { and, eq, sql } from "drizzle-orm";
import { auth } from "./auth";
import { verifyProviderAccount } from "./provider-proof";

async function readSecret(prompt: string) {
  if (!process.stdin.isTTY || !process.stdin.setRawMode) throw new Error("Run this command in a private interactive terminal.");
  process.stdout.write(prompt);
  process.stdin.setRawMode(true);
  process.stdin.setEncoding("utf8");
  process.stdin.resume();
  const { promise, resolve, reject } = Promise.withResolvers<string>();
  let secret = "";
  const finish = (error?: Error) => {
    process.stdin.setRawMode(false);
    process.stdin.pause();
    process.stdin.off("data", onData);
    process.stdout.write("\n");
    if (error) reject(error);
    else resolve(secret);
  };
  const onData = (chunk: string) => {
    for (const char of chunk) {
      if (char === "\u0003") return finish(new Error("Recovery cancelled"));
      if (char === "\r" || char === "\n") return finish();
      if (char === "\u007f" || char === "\b") secret = secret.slice(0, -1);
      else secret += char;
    }
  };
  process.stdin.on("data", onData);
  return promise;
}

try {
  if (process.env.NODE_ENV === "production" && process.env.TEST_PRODUCTION !== "true") {
    throw new Error("Reviewed recovery is enabled only in development and test-production.");
  }
  const email = process.argv[2]?.trim().toLowerCase();
  const provider = process.argv[3];
  if (!email || (provider !== "google" && provider !== "github")) {
    throw new Error("Usage: bun run recover-identity <email> <google|github>");
  }
  const [identity] = await db.select({ id: user.id, email: user.email, disabled: user.disabled })
    .from(user).where(eq(user.email, email)).limit(1);
  if (!identity || identity.disabled) throw new Error("Central Identity was not found or is disabled.");
  const [credential] = await db.select({ password: account.password }).from(account).where(and(
    eq(account.userId, identity.id),
    eq(account.providerId, "credential"),
  )).limit(1);
  if (!credential?.password) throw new Error("Central Identity has no retained password credential.");
  const password = await readSecret("Old Central password: ");
  const context = await auth.$context;
  if (!await context.password.verify({ hash: credential.password, password })) {
    throw new Error("The old Central credential did not match.");
  }
  const providerToken = await readSecret(`${provider} access token: `);
  const proof = await verifyProviderAccount(provider, providerToken);
  console.info(JSON.stringify({
    event: "recovery.provider_proof_verified",
    provider,
    providerAccountId: proof.accountId,
    providerName: proof.name,
    verifiedEmail: proof.email,
    centralIdentityEmail: identity.email,
  }));
  console.info("Confirm provider ownership using information beyond matching email; cancel if you cannot identify the same person.");
  if (await readSecret(`Type LINK ${proof.accountId} to confirm: `) !== `LINK ${proof.accountId}`) {
    throw new Error("Provider identity confirmation did not match.");
  }
  await db.transaction(async (tx) => {
    const [target] = await tx.select({ disabled: user.disabled }).from(user)
      .where(eq(user.id, identity.id)).for("update").limit(1);
    if (!target || target.disabled) throw new Error("Central Identity was not found or is disabled.");
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${provider}), hashtext(${proof.accountId}))`);
    const [existing] = await tx.select({ id: account.id }).from(account).where(and(
      eq(account.userId, identity.id),
      eq(account.providerId, provider),
    )).limit(1);
    if (existing) throw new Error("That provider is already linked to the Central Identity.");
    const [duplicate] = await tx.select({ id: account.id }).from(account).where(and(
      eq(account.providerId, provider),
      eq(account.accountId, proof.accountId),
    )).limit(1);
    if (duplicate) throw new Error("That provider account is already linked to another identity.");
    await tx.insert(account).values({
      id: randomUUID(),
      userId: identity.id,
      providerId: provider,
      accountId: proof.accountId,
      updatedAt: new Date(),
    });
  });
  console.info("Provider account linked. Existing Central sessions and credentials were retained.");
} finally {
  await closeDatabase();
}
