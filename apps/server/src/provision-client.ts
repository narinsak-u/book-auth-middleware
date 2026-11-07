import { provisionOAuthClient } from "./provision-oauth-client";

const [clientName, emailPrefix, signInCallback, recoveryCallback, ...extra] = process.argv.slice(2);
if (!clientName || !emailPrefix || !signInCallback || extra.length) {
  throw new Error("Usage: bun run provision:client <client-name> <email-prefix> <https-sign-in-callback> [https-recovery-callback]");
}

await provisionOAuthClient(clientName, emailPrefix, recoveryCallback
  ? [signInCallback, recoveryCallback]
  : [signInCallback]);
