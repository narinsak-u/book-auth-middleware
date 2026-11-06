import { describe, expect, test } from "bun:test";
import { validateOAuthRedirectURIs } from "./provision-oauth-client";

const signInCallback = "https://third.example.test/oidc/callback";
const recoveryCallback = "https://third.example.test/recovery/callback";

describe("owned OAuth callback registration", () => {
  test("accepts one exact application callback or one same-origin recovery callback", () => {
    expect(() => validateOAuthRedirectURIs([signInCallback])).not.toThrow();
    expect(() => validateOAuthRedirectURIs([signInCallback, recoveryCallback])).not.toThrow();
  });

  test("rejects callbacks that are insecure, duplicate, extra, unsafe, or cross-origin", () => {
    for (const callbacks of [
      ["http://third.example.test/oidc/callback"],
      [signInCallback, signInCallback],
      [signInCallback, recoveryCallback, "https://third.example.test/extra"],
      [signInCallback, "https://other.example.test/recovery/callback"],
      [`${signInCallback}?next=https://other.example.test`],
      [`${signInCallback}#fragment`],
      ["https://user:password@third.example.test/oidc/callback"],
    ]) {
      expect(() => validateOAuthRedirectURIs(callbacks)).toThrow();
    }
  });
});
