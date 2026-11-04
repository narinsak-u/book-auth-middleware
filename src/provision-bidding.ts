import { provisionOAuthClient } from "./provision-oauth-client";

await provisionOAuthClient(
  "Book Bidding",
  "bidding-oauth-provisioner",
  "https://bidding.127.0.0.1.sslip.io/api/auth/callback/central-identity",
);
