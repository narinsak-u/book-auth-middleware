import { describe, expect, test } from "bun:test";

const provider = process.env.TEST_PROVIDER_URL ?? "https://auth.127.0.0.1.nip.io";
const inbox = process.env.TEST_MAILPIT_URL ?? "http://localhost:8025";
const email = `central-${crypto.randomUUID()}@example.test`;
const password = "local-proof-password-123";

async function mailUrl(address: string, subject: string) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const found = await fetch(`${inbox}/api/v1/search?query=${encodeURIComponent(`to:${address}`)}`);
    if (found.ok) {
      const result = await found.json() as { messages?: Array<{ ID: string; Subject: string }> };
      for (const message of result.messages ?? []) {
        if (message.Subject !== subject) continue;
        const captured = await fetch(`${inbox}/api/v1/message/${message.ID}`);
        const data = await captured.json() as { Text?: string; HTML?: string };
        const text = `${data.Text ?? ""}\n${data.HTML ?? ""}`;
        const url = text.match(/https?:\/\/[^\s<>"']+/)?.[0];
        if (url) return url.replaceAll("&amp;", "&");
      }
    }
    // Mail delivery is asynchronous and observable through Mailpit's public API.
    await Bun.sleep(100);
  }
  throw new Error(`${subject} email did not arrive in Mailpit`);
}

async function verificationUrl(address: string) {
  return mailUrl(address, "Verify your Central Identity email");
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
  test("password recovery works through the site and Mailpit without revealing or reusing credentials", async () => {
    const recoveryEmail = `recovery-${crypto.randomUUID()}@example.test`;
    const initialPassword = "initial-central-password-123";
    const signup = await fetch(`${provider}/api/auth/sign-up/email`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Recovery Test User", email: recoveryEmail, password: initialPassword }),
    });
    expect(signup.ok).toBe(true);
    expect([302, 303]).toContain((await fetch(await verificationUrl(recoveryEmail), { redirect: "manual" })).status);

    const html = await (await fetch(provider)).text();
    expect(html).toContain('id="forgot-password"');

    const requestReset = (address: string) => fetch(`${provider}/api/auth/request-password-reset`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: address, redirectTo: provider }),
    });
    const unknown = await requestReset(`missing-${crypto.randomUUID()}@example.test`);
    const requested = await requestReset(recoveryEmail);
    expect(requested.status).toBe(unknown.status);
    expect(await requested.clone().json()).toEqual(await unknown.json());
    expect(await requested.text()).not.toContain(recoveryEmail);

    const resetUrl = await mailUrl(recoveryEmail, "Reset your Central Identity password");
    const followed = await fetch(resetUrl, { redirect: "manual" });
    expect([302, 303]).toContain(followed.status);
    const resetPage = new URL(followed.headers.get("location")!);
    expect(resetPage.searchParams.has("token")).toBe(true);
    const token = resetPage.searchParams.get("token")!;
    expect(await (await fetch(resetPage)).text()).toContain('id="reset-password"');
    const reset = (newPassword: string) => fetch(`${provider}/api/auth/reset-password`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token, newPassword }),
    });
    expect((await reset("new-central-password-456")).ok).toBe(true);
    expect((await reset("reused-link-password-789")).ok).toBe(false);

    const oldPasswordLogin = await fetch(`${provider}/api/auth/sign-in/email`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: recoveryEmail, password: initialPassword }),
    });
    expect(oldPasswordLogin.ok).toBe(false);
    const newPasswordLogin = await fetch(`${provider}/api/auth/sign-in/email`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: recoveryEmail, password: "new-central-password-456" }),
    });
    expect(newPasswordLogin.ok).toBe(true);
  }, 60_000);


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

    const verified = await fetch(await verificationUrl(email), { redirect: "manual" });
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
    const freshLogin = await fetch(`${provider}/api/auth/sign-in/email`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    expect(freshLogin.ok).toBe(true);
    const freshCookies = freshLogin.headers.getSetCookie();
    const freshCookie = freshCookies.map((value) => value.split(";", 1)[0]).join("; ");
    const freshSession = await fetch(`${provider}/api/auth/get-session`, { headers: { cookie: freshCookie } });
    expect(freshSession.status).toBe(200);
    expect(await freshSession.json()).toMatchObject({ user: { email }, session: { token: expect.any(String) } });

    const signedOut = await fetch(`${provider}/api/auth/sign-out`, {
      method: "POST",
      headers: { cookie: freshCookie, origin: new URL(provider).origin, "content-type": "application/json" },
    });
    expect(signedOut.ok).toBe(true);
    const invalidated = await fetch(`${provider}/api/auth/get-session`, { headers: { cookie: freshCookie } });
    expect(await invalidated.json()).toBeNull();
  }, 60_000);
});
