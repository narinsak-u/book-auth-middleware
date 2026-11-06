import { closeDatabase, db, oauthClient } from "@central-identity/db";
import { eq } from "drizzle-orm";

const [clientId, ...extra] = process.argv.slice(2);
if (!clientId || extra.length) {
  throw new Error("Usage: bun run disable:client <client-id>");
}

try {
  const [client] = await db.update(oauthClient)
    .set({ disabled: true })
    .where(eq(oauthClient.clientId, clientId))
    .returning({ clientId: oauthClient.clientId });
  if (!client) throw new Error("OAuth client was not found");
  console.log(`OAuth client ${client.clientId} disabled. Its registration and credentials remain; existing Application Sessions and issued tokens are unchanged.`);
} finally {
  await closeDatabase();
}
