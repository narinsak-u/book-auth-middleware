import { closeDatabase } from "@central-identity/db";

export function allowedOAuthCallback(url: URL, production = process.env.NODE_ENV === "production" || process.env.TEST_PRODUCTION === "true") {
  return url.protocol === "https:" || (!production && url.protocol === "http:" && url.hostname === "localhost");
}

export function validateOAuthRedirectURIs(redirectURIs: string[], production = process.env.NODE_ENV === "production" || process.env.TEST_PRODUCTION === "true") {
  if (redirectURIs.length < 1 || redirectURIs.length > 2) {
    throw new Error("OAuth clients require one sign-in callback and at most one recovery callback");
  }
  const callbacks = redirectURIs.map((uri) => new URL(uri));
  if (
    new Set(redirectURIs).size !== redirectURIs.length ||
    callbacks.some((url, index) =>
      !allowedOAuthCallback(url, production) || url.origin + url.pathname !== redirectURIs[index] ||
      url.search || url.hash || url.username || url.password
    ) ||
    callbacks.some((url) => url.origin !== callbacks[0].origin)
  ) {
    throw new Error("OAuth callbacks must be exact HTTPS URIs (or localhost HTTP in development) on one origin without query, fragment, or credentials");
  }
}

export async function provisionOAuthClient(clientName: string, emailPrefix: string, redirectURIs: string[]) {
  validateOAuthRedirectURIs(redirectURIs);
  // Dynamic import is required so this privilege is set before auth initializes.
  process.env.OIDC_CLIENT_PROVISIONING = "true";
  const { auth } = await import("./auth");
  const baseURL = process.env.BETTER_AUTH_URL ?? "http://localhost:8080";

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
          // Better Auth classifies HTTP loopback callbacks as native even for a server-side confidential client.
          application_type: redirectURIs[0].startsWith("http://localhost:") ? "native" : "web",
          redirect_uris: redirectURIs,
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
      console.log(JSON.stringify({ clientId: client.client_id, clientSecret: client.client_secret, redirectURIs }, null, 2));
    } finally {
      await context.internalAdapter.deleteUserSessions(user.id);
      await context.internalAdapter.deleteAccounts(user.id);
      await context.internalAdapter.deleteUser(user.id);
    }
  } finally {
    await closeDatabase();
  }
}
