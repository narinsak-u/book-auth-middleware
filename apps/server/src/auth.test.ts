import { describe, expect, test } from "bun:test";

const provider = process.env.TEST_PROVIDER_URL;

describe.skipIf(!provider)("Central Identity public HTTP behavior", () => {

async function retired(path: string, body: object, invitation?: string) {
  return fetch(`${provider}/api/auth/${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(invitation ? { "x-enrollment-invitation": invitation } : {}),
    },
    body: JSON.stringify(body),
  });
}

  test("rejects legacy enrollment and password authentication", async () => {
    const signup = await retired("sign-up/email", {
      name: "Legacy User",
      email: `legacy-${crypto.randomUUID()}@example.test`,
      password: "local-proof-password-123",
    });
    expect((await retired("sign-up/email", {
      name: "Legacy User",
      email: `legacy-${crypto.randomUUID()}@example.test`,
      password: "local-proof-password-123",
    }, crypto.randomUUID())).status).toBe(410);
    expect(signup.status).toBe(410);

    const signin = await retired("sign-in/email", {
      email: `legacy-${crypto.randomUUID()}@example.test`,
      password: "local-proof-password-123",
    });
    expect(signin.status).toBe(410);
  });

  test("rejects legacy password reset endpoints", async () => {
    expect((await retired("request-password-reset", { email: "person@example.test" })).status).toBe(410);
    expect((await retired("reset-password", { token: "retired", newPassword: "local-proof-password-123" })).status).toBe(410);
  });

  test("keeps public OIDC discovery and readiness available", async () => {
    const discovery = await fetch(`${provider}/api/auth/.well-known/openid-configuration`);
    expect(discovery.status).toBe(200);
    expect((await discovery.json()).issuer).toBe(`${provider}/api/auth`);
    expect((await fetch(`${provider}/health/ready`)).status).toBe(200);
  });
});
