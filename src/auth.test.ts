import { describe, expect, test } from "bun:test";

const provider = process.env.TEST_PROVIDER_URL ?? "https://auth.127.0.0.1.nip.io";
const inbox = process.env.TEST_MAILPIT_URL ?? "http://localhost:8025";
const email = `central-${crypto.randomUUID()}@example.test`;
const password = "local-proof-password-123";

async function verificationUrl() {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const found = await fetch(`${inbox}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`);
    if (found.ok) {
      const result = await found.json() as { messages?: Array<{ ID: string }> };
      const message = result.messages?.[0];
      if (message) {
        const captured = await fetch(`${inbox}/api/v1/message/${message.ID}`);
        const data = await captured.json() as { Text?: string; HTML?: string };
        const text = `${data.Text ?? ""}\n${data.HTML ?? ""}`;
        const url = text.match(/https?:\/\/[^\s<>"']+/)?.[0];
        if (url) return url.replaceAll("&amp;", "&");
      }
    }
    // Mail delivery is asynchronous and exposed only through Mailpit's HTTP API.
    await Bun.sleep(100);
  }
  throw new Error("Verification email did not arrive in Mailpit");
}

describe("central identity public HTTP behavior", () => {
  test("liveness and readiness respond while the database is available", async () => {
    const live = await fetch(`${provider}/health/live`);
    expect(live.status).toBe(200);
    expect(await live.json()).toEqual({ status: "live" });

    const ready = await fetch(`${provider}/health/ready`);
    expect(ready.status).toBe(200);
    expect(await ready.json()).toEqual({ status: "ready" });
  });

  test("signs in only after verification, survives a provider restart, and invalidates on sign-out", async () => {
    const signup = await fetch(`${provider}/api/auth/sign-up/email`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Local Test User", email, password }),
    });
    expect(signup.ok).toBe(true);

    const denied = await fetch(`${provider}/api/auth/sign-in/email`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    expect(denied.status).toBe(403);

    const verified = await fetch(await verificationUrl(), { redirect: "manual" });
    expect([302, 303]).toContain(verified.status);

    const signedIn = await fetch(`${provider}/api/auth/sign-in/email`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    expect(signedIn.ok).toBe(true);
    const setCookies = signedIn.headers.getSetCookie();
    const cookie = setCookies.map((value) => value.split(";", 1)[0]).join("; ");
    expect(cookie).toContain("better-auth");
    expect(setCookies.join(";")).toContain("Secure");
    expect(setCookies.join(";")).toContain("HttpOnly");
    expect(setCookies.join(";")).not.toMatch(/;\s*Domain=/i);
    const session = await fetch(`${provider}/api/auth/get-session`, { headers: { cookie } });
    expect(session.status).toBe(200);
    expect(await session.json()).toMatchObject({ user: { email }, session: { token: expect.any(String) } });
    const restart = Bun.spawnSync(["docker", "compose", "restart", "auth"], { cwd: process.cwd() });
    expect(restart.exitCode).toBe(0);
    let ready = false;
    for (let attempt = 0; attempt < 100 && !ready; attempt++) {
      try {
        ready = (await fetch(`${provider}/health/ready`)).ok;
      } catch {
        // The public server is expected to disconnect while its container restarts.
      }
      if (!ready) await Bun.sleep(100);
    }
    expect(ready).toBe(true);
    const restored = await fetch(`${provider}/api/auth/get-session`, { headers: { cookie } });
    expect(await restored.json()).toMatchObject({ user: { email } });


    const signedOut = await fetch(`${provider}/api/auth/sign-out`, {
      method: "POST",
      headers: { cookie, origin: new URL(provider).origin, "content-type": "application/json" },
    });
    expect(signedOut.ok).toBe(true);
    const invalidated = await fetch(`${provider}/api/auth/get-session`, { headers: { cookie } });
    expect(await invalidated.json()).toBeNull();
  }, 60_000);
});
