import { eq } from "drizzle-orm";
import { closeDatabase, db } from "./db";
import { user } from "./schema";

const email = process.env.CENTRAL_IDENTITY_EMAIL;
if (!email) throw new Error("Set CENTRAL_IDENTITY_EMAIL to the exact identity email");

try {
  const result = await db.update(user).set({ disabled: true }).where(eq(user.email, email)).returning({ id: user.id });
  if (result.length !== 1) throw new Error("Central Identity was not found");
  console.log("Central Identity disabled. Existing Application Sessions remain active until their own expiry or revocation.");
} finally {
  await closeDatabase();
}
