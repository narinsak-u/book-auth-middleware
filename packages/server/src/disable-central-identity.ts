import { eq } from "drizzle-orm";
import { closeDatabase, db, session, user } from "@central-identity/db";

const email = process.env.CENTRAL_IDENTITY_EMAIL;
if (!email) throw new Error("Set CENTRAL_IDENTITY_EMAIL to the exact identity email");

try {
  const identity = await db.transaction(async (tx) => {
    const [identity] = await tx.update(user)
      .set({ disabled: true })
      .where(eq(user.email, email))
      .returning({ id: user.id });
    if (!identity) return undefined;
    await tx.delete(session).where(eq(session.userId, identity.id));
    return identity;
  });
  if (!identity) throw new Error("Central Identity was not found");
  console.log("Central Identity disabled. Existing Application Sessions remain active until their own expiry or revocation.");
} finally {
  await closeDatabase();
}
