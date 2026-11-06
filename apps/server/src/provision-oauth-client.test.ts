import { describe, expect, test } from "bun:test";
import { validateOAuthRedirectURIs } from "./provision-oauth-client";

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
    expect(() => validateOAuthRedirectURIs(developmentCallbacks)).not.toThrow();
    expect(() => validateOAuthRedirectURIs([
      newCallbacks[0],
      `${newCallbacks[1]}?next=https://other.example.test`,
    ])).toThrow();
  });

});
