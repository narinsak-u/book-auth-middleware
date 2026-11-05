import { provisionOAuthClient } from "./provision-oauth-client";

const redirectURI = process.env.READING_OIDC_REDIRECT_URI ??
  (process.env.NODE_ENV === "production" ? undefined : "https://reading.lvh.me:8080/api/auth/callback/central-identity");
if (!redirectURI) throw new Error("Set READING_OIDC_REDIRECT_URI before provisioning in production");

await provisionOAuthClient("Read in Peace", "reading-oauth-provisioner", redirectURI);
