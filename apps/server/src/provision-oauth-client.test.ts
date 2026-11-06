import { describe, expect, test } from "bun:test";
import { validateOAuthRedirectURIs } from "./provision-oauth-client";

const testCallbacks = [
  "https://bidding-test.localhost:8081/api/auth/callback/central-identity",
  "https://bidding-test.localhost:8081/api/identity-recovery/callback",
];
const developmentCallbacks = [
  "https://bidding.localhost:8080/api/auth/callback/central-identity",
  "https://bidding.localhost:8080/api/identity-recovery/callback",
];
const newCallbacks = [
  "https://bidding.example.test/api/auth/callback/central-identity",
  "https://bidding.example.test/api/identity-recovery/callback",
];

describe("first-party OAuth callback registration", () => {

  test("accepts and rejects exact callback pairs", () => {
    expect(() => validateOAuthRedirectURIs(testCallbacks)).not.toThrow();
    expect(() => validateOAuthRedirectURIs(developmentCallbacks)).not.toThrow();
    expect(() => validateOAuthRedirectURIs(newCallbacks)).not.toThrow();
    expect(() => validateOAuthRedirectURIs([
      testCallbacks[0],
      `${testCallbacks[1]}?next=https://other.example.test`,
    ])).toThrow();
  });

});
