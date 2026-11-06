import { provisionOAuthClient } from "./provision-oauth-client";

const testProduction = process.env.TEST_PRODUCTION === "true";
const production = process.env.NODE_ENV === "production" && !testProduction;
const origin = production
  ? undefined
  : testProduction
    ? "https://bidding-test.127.0.0.1.sslip.io:8081"
    : "https://bidding.127.0.0.1.sslip.io:8080";
const redirectURI = process.env.BIDDING_OIDC_REDIRECT_URI ?? (origin && `${origin}/api/auth/callback/central-identity`);
const recoveryRedirectURI = process.env.BIDDING_RECOVERY_OIDC_REDIRECT_URI ?? (origin && `${origin}/api/identity-recovery/callback`);
if (!redirectURI || !recoveryRedirectURI) {
  throw new Error("Set BIDDING_OIDC_REDIRECT_URI and BIDDING_RECOVERY_OIDC_REDIRECT_URI before provisioning in production");
}

await provisionOAuthClient("Book Bidding", "bidding-oauth-provisioner", [redirectURI, recoveryRedirectURI]);
