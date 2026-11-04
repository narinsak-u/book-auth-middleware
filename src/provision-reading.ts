import { provisionOAuthClient } from "./provision-oauth-client";

await provisionOAuthClient(
  "Read in Peace",
  "reading-oauth-provisioner",
  "https://reading.lvh.me/api/auth/callback/central-identity",
);
