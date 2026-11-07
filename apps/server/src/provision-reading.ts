import { provisionOAuthClient } from "./provision-oauth-client";

const testProduction = process.env.TEST_PRODUCTION === "true";
const production = process.env.NODE_ENV === "production" && !testProduction;
const origin = production
  ? undefined
  : testProduction
    ? "https://reading-test.localhost:8081"
    : "http://localhost:3001"
const redirectURI = process.env.READING_OIDC_REDIRECT_URI ?? (origin && `${origin}/api/auth/callback/central-identity`);
const recoveryRedirectURI = process.env.READING_RECOVERY_OIDC_REDIRECT_URI ?? (origin && `${origin}/api/identity-recovery/callback`);
if (!redirectURI || !recoveryRedirectURI) {
  throw new Error("Set READING_OIDC_REDIRECT_URI and READING_RECOVERY_OIDC_REDIRECT_URI before provisioning in production");
}

await provisionOAuthClient("Read in Peace", "reading-oauth-provisioner", [redirectURI, recoveryRedirectURI]);
