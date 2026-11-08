import { provisionOAuthClient } from "./provision-oauth-client";

const [clientName, emailPrefix, signInCallback, recoveryCallback, ...extra] = process.argv.slice(2);
if (!clientName || !emailPrefix || !signInCallback || extra.length) {
  throw new Error("Usage: bun run provision:client <client-name> <email-prefix> <exact-http-localhost-or-https-sign-in-callback> [recovery-callback]");
}

await provisionOAuthClient(clientName, emailPrefix, recoveryCallback
  ? [signInCallback, recoveryCallback]
  : [signInCallback]);
