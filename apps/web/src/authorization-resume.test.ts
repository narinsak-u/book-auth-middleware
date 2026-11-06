import { expect, test } from "bun:test";
import { authorizationResume, resumeSignInPath, verificationCallback } from "./authorization-resume";

test("verification preserves the registered Relying Party destination without carrying expired authorization state", () => {
  const original = "client_id=reading-client&redirect_uri=https%3A%2F%2Freading.example.test%2Fapi%2Fauth%2Fcallback%2Fcentral-identity&state=expired-state&sig=expired-signature";
  const resume = authorizationResume(original);

  expect(resume).toEqual({
    clientId: "reading-client",
    redirectUri: "https://reading.example.test/api/auth/callback/central-identity",
  });
  expect(resumeSignInPath(resume)).toBe(
    "/sign-in?resume_client_id=reading-client&resume_redirect_uri=https%3A%2F%2Freading.example.test%2Fapi%2Fauth%2Fcallback%2Fcentral-identity",
  );
  const callback = new URL(verificationCallback("https://auth.example.test", resume));
  expect(callback.pathname).toBe("/sign-in");
  expect(callback.searchParams.get("verified")).toBe("1");
  expect(callback.searchParams.has("oauth_query")).toBe(false);
  expect(callback.searchParams.has("sig")).toBe(false);
});

test("does not retain an incomplete authorization destination", () => {
  expect(authorizationResume("client_id=reading-client&state=expired-state")).toBeUndefined();
  expect(verificationCallback("https://auth.example.test", undefined))
    .toBe("https://auth.example.test/sign-in?verified=1");
});
