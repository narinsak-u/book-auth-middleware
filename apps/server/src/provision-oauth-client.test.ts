import { describe, expect, test } from "bun:test";
import { validateOAuthRedirectURIs } from "./provision-oauth-client";

describe("first-party OAuth callback registration", () => {
  test("accepts exact sign-in and recovery callbacks on one HTTPS origin", () => {
    expect(() => validateOAuthRedirectURIs([
      "https://bidding.127.0.0.1.sslip.io:8080/api/auth/callback/central-identity",
      "https://bidding.127.0.0.1.sslip.io:8080/api/identity-recovery/callback",
    ])).not.toThrow();
  });

  test("rejects callback URI changes outside the exact registered pair", () => {
    const signIn = "https://bidding.127.0.0.1.sslip.io:8080/api/auth/callback/central-identity";
    const recovery = "https://bidding.127.0.0.1.sslip.io:8080/api/identity-recovery/callback";
    for (const invalid of [
      [signIn],
      [signIn, "http://bidding.127.0.0.1.sslip.io:8080/api/identity-recovery/callback"],
      [signIn, "https://other.example/api/identity-recovery/callback"],
      [signIn, `${recovery}?next=https://other.example`],
      [signIn, "https://bidding.127.0.0.1.sslip.io:8080/api/auth/callback/central-identity"],
    ]) {
      expect(() => validateOAuthRedirectURIs(invalid)).toThrow();
    }
  });
});
