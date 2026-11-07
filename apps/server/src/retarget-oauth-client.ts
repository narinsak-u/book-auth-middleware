import { auth } from "./auth";
import { closeDatabase } from "@central-identity/db";
import { validateOAuthRedirectURIs } from "./provision-oauth-client";

const clientNames = {
  bidding: "Book Bidding",
  reading: "Read in Peace",
} as const;

type OAuthClientAdapter = {
  findOne: (query: { model: "oauthClient"; where: { field: "clientId"; value: string }[] }) => Promise<{
    id: string;
    clientId: string;
    userId: string | null;
    name: string | null;
  } | null>;
  updateMany: (change: {
    model: "oauthClient";
    where: { field: string; value: string | null }[];
    update: { redirectUris: string[]; applicationType: "native" | "web" };
  }) => Promise<number>;
};

async function retargetOAuthClient(
  clientName: string,
  clientId: string,
  redirectURIs: string[],
  adapter: OAuthClientAdapter,
) {
  validateOAuthRedirectURIs(redirectURIs);
  if (!Object.values(clientNames).includes(clientName as typeof clientNames[keyof typeof clientNames])) {
    throw new Error("Only the registered Bidding and Reading clients can be retargeted");
  }
  if (!clientId) throw new Error("The configured OAuth client ID is required");

  const client = await adapter.findOne({
    model: "oauthClient",
    where: [{ field: "clientId", value: clientId }],
  });
  if (!client || client.userId !== null || client.name !== clientName) {
    throw new Error("Configured OAuth client is not the expected detached first-party client");
  }
  const updated = await adapter.updateMany({
    model: "oauthClient",
    where: [
      { field: "id", value: client.id },
      { field: "clientId", value: clientId },
      { field: "name", value: clientName },
      { field: "userId", value: null },
    ],
    update: {
      redirectUris: redirectURIs,
      applicationType: redirectURIs[0].startsWith("http://localhost:") ? "native" : "web",
    },
  });
  if (updated !== 1) throw new Error("OAuth client changed before its callbacks could be updated");
}

const target = process.argv[2];
if (import.meta.main) {
  const clientName = target && target in clientNames
    ? clientNames[target as keyof typeof clientNames]
    : undefined;
  const clientId = target === "bidding"
    ? process.env.BIDDING_OIDC_CLIENT_ID
    : target === "reading"
      ? process.env.READING_OIDC_CLIENT_ID
      : undefined;
  const signIn = process.env.OIDC_SIGN_IN_REDIRECT_URI;
  const recovery = process.env.OIDC_RECOVERY_REDIRECT_URI;
  if (!clientName || !clientId || !signIn || !recovery) {
    throw new Error("Usage: bun run retarget:oauth-client <bidding|reading> with its configured client ID and OIDC_SIGN_IN_REDIRECT_URI and OIDC_RECOVERY_REDIRECT_URI set");
  }
  validateOAuthRedirectURIs([signIn, recovery]);
  try {
    const context = await auth.$context;
    await retargetOAuthClient(clientName, clientId, [signIn, recovery], context.adapter as unknown as OAuthClientAdapter);
    console.log(`Retargeted ${clientName} OAuth callbacks`);
  } finally {
    await closeDatabase();
  }
}

