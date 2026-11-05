import { afterEach, expect, test } from "bun:test";
import { verifyProviderAccount } from "./provider-proof";

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

test("Google recovery requires a verified email and binds the provider subject", async () => {
  let verified = false;
  globalThis.fetch = (async () => Response.json({ sub: "google-123", email: "owner@example.test", email_verified: verified })) as unknown as typeof fetch;
  await expect(verifyProviderAccount("google", "temporary-proof")).rejects.toThrow("verified email");
  verified = true;
  expect(await verifyProviderAccount("google", "temporary-proof")).toMatchObject({
    accountId: "google-123", email: "owner@example.test",
  });
});

test("GitHub recovery rejects unverified email and binds the numeric account ID", async () => {
  let verified = false;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const path = new URL(String(input)).pathname;
    return Response.json(path === "/user/emails"
      ? [{ email: "owner@example.test", primary: true, verified }]
      : { id: 420, login: "owner" });
  }) as typeof fetch;
  await expect(verifyProviderAccount("github", "temporary-proof")).rejects.toThrow("verified email");
  verified = true;
  expect(await verifyProviderAccount("github", "temporary-proof")).toMatchObject({
    accountId: "420", email: "owner@example.test",
  });
});
