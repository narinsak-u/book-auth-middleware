import { describe, expect, test } from "bun:test";

const provider = process.env.TEST_PROVIDER_URL;
const mailpit = process.env.TEST_MAILPIT_URL;

describe.skipIf(!provider)("Central Identity public HTTP behavior", () => {

async function authPost(path: string, body: object) {
  return fetch(`${provider}/api/auth/${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

  test("accepts open credential registration and rejects duplicate usernames", async () => {
    const username = `person_${crypto.randomUUID().slice(0, 8)}`;
    const email = `${crypto.randomUUID()}@example.test`;
    const signup = await authPost("sign-up/email", {
      name: "Registration User",
      username,
      email,
      password: "verified-password-123",
    });
    expect(signup.status).toBe(200);

    const duplicate = await authPost("sign-up/email", {
      name: "Second User",
      username: username.toUpperCase(),
      email: `${crypto.randomUUID()}@example.test`,
      password: "verified-password-123",
    });
    expect(duplicate.status).toBeGreaterThanOrEqual(400);
  });

  test.skipIf(!mailpit)("verifies open registration before username and email sign-in", async () => {
    const username = `person_${crypto.randomUUID().slice(0, 8)}`;
    const email = `${crypto.randomUUID()}@example.test`;
    const signup = await authPost("sign-up/email", {
      name: "Verified User",
      username,
      email,
      password: "verified-password-123",
      callbackURL: `${provider}/sign-in?verified=1`,
    });
    expect(signup.status).toBe(200);

    const inbox = await fetch(`${mailpit}/api/v1/messages?query=to:${encodeURIComponent(email)}`);
    const message = (await inbox.json()).messages[0];
    const mail = await fetch(`${mailpit}/api/v1/message/${message.ID}`);
    const verificationURL = (await mail.json()).Text.match(/https?:\/\/[^\s<>"]+/)?.[0];
    expect(typeof verificationURL).toBe("string");
    await fetch(verificationURL!, { redirect: "manual" });

    for (const identifier of [username, email]) {
      const signin = await authPost(
        identifier === email ? "sign-in/email" : "sign-in/username",
        identifier === email
          ? { email: identifier, password: "verified-password-123" }
          : { username: identifier, password: "verified-password-123" },
      );
      expect(signin.status).toBe(200);
      expect(signin.headers.get("set-cookie")).toContain("session_token=");
    }
    const absent = await authPost("sign-in/username", {
      username: `missing_${crypto.randomUUID().slice(0, 8)}`,
      password: "wrong-password-123",
    });
    const wrong = await authPost("sign-in/username", {
      username,
      password: "wrong-password-123",
    });
    expect(absent.status).toBe(wrong.status);
    expect(await absent.text()).toBe(await wrong.text());
  });


  test("keeps public OIDC discovery and readiness available", async () => {
    const discovery = await fetch(`${provider}/api/auth/.well-known/openid-configuration`);
    expect(discovery.status).toBe(200);
    expect((await discovery.json()).issuer).toBe(`${provider}/api/auth`);
    expect((await fetch(`${provider}/health/ready`)).status).toBe(200);
  });
});
