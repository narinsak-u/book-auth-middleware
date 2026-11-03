process.env.BIDDING_OIDC_PROVISIONING = "true";
const { auth } = await import("./auth");
const redirectURI = "https://bidding.127.0.0.1.sslip.io/api/auth/callback/central-identity";
const client = await auth.api.adminCreateOAuthClient({
  headers: new Headers(),
  body: {
    client_name: "Book Bidding",
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

console.log(JSON.stringify({
  clientId: client.client_id,
  clientSecret: client.client_secret,
  redirectURI,
}, null, 2));
