import { closeDatabase } from "@central-identity/db";

export async function provisionOAuthClient(clientName: string, emailPrefix: string, redirectURI: string) {
  // Dynamic import is required so this privilege is set before auth initializes.
  process.env.BIDDING_OIDC_PROVISIONING = "true";
  const { auth } = await import("./auth");
  const baseURL = process.env.BETTER_AUTH_URL ?? "https://auth.127.0.0.1.nip.io";

  try {
    const context = await auth.$context;
    const user = await context.internalAdapter.createUser({
      name: `Temporary ${clientName} OAuth provisioner`,
      email: `${emailPrefix}-${crypto.randomUUID()}@example.invalid`,
      emailVerified: true,
    }, { method: "email-password" });
    try {
      const password = crypto.randomUUID() + crypto.randomUUID();
      const passwordHash = await context.password.hash(password);
      await context.internalAdapter.linkAccount({
        userId: user.id,
        providerId: "credential",
        accountId: user.id,
        password: passwordHash,
      });
      const signIn = await auth.handler(new Request(`${baseURL}/api/auth/sign-in/email`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: baseURL },
        body: JSON.stringify({ email: user.email, password }),
      }));
      if (!signIn.ok) throw new Error(`Temporary operator sign-in failed (${signIn.status})`);
      const sessionCookie = signIn.headers.getSetCookie()
        .find((cookie) => cookie.includes("session_token="))
        ?.split(";", 1)[0];
      if (!sessionCookie) throw new Error("Temporary operator sign-in did not return a session cookie");

      const client = await auth.api.adminCreateOAuthClient({
        headers: new Headers({ cookie: sessionCookie }),
        body: {
          client_name: clientName,
          application_type: "web",
          redirect_uris: [redirectURI],
          token_endpoint_auth_method: "client_secret_basic",
          grant_types: ["authorization_code"],
          response_types: ["code"],
          scope: "openid email profile",
          require_pkce: true,
          client_secret_expires_at: 0,
          skip_consent: true,
        },
      });
      if (!client.client_id || !client.client_secret) {
        throw new Error("OAuth client creation did not return one-time client credentials");
      }
      await context.adapter.update({
        model: "oauthClient",
        where: [{ field: "clientId", value: client.client_id }],
        update: { userId: null },
      });
      const detached = await context.adapter.findOne<{ userId: string | null }>({
        model: "oauthClient",
        where: [{ field: "clientId", value: client.client_id }],
      });
      if (!detached || detached.userId) throw new Error("OAuth client was not detached from its temporary owner");
      console.log(JSON.stringify({ clientId: client.client_id, clientSecret: client.client_secret, redirectURI }, null, 2));
    } finally {
      await context.internalAdapter.deleteUserSessions(user.id);
      await context.internalAdapter.deleteAccounts(user.id);
      await context.internalAdapter.deleteUser(user.id);
    }
  } finally {
    await closeDatabase();
  }
}
