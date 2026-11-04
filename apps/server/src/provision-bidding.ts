import { provisionOAuthClient } from "./provision-oauth-client";

const redirectURI = process.env.BIDDING_OIDC_REDIRECT_URI ??
  (process.env.NODE_ENV === "production" ? undefined : "https://bidding.127.0.0.1.sslip.io/api/auth/callback/central-identity");
if (!redirectURI) throw new Error("Set BIDDING_OIDC_REDIRECT_URI before provisioning in production");

await provisionOAuthClient("Book Bidding", "bidding-oauth-provisioner", redirectURI);
