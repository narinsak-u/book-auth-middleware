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

async function signInExisting(address: string) {
  const response = await fetch(`${provider}/api/auth/sign-in/email`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: address, password }),
  });
  expect(response.ok).toBe(true);
  return response.headers.getSetCookie().map((value) => value.split(";", 1)[0]).join("; ");
}

async function signIn(address: string) {
  const signup = await fetch(`${provider}/api/auth/sign-up/email`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "OIDC Protocol User", email: address, password }),
  });
  expect(signup.ok).toBe(true);
  const verified = await fetch(await verificationUrl(address), { redirect: "manual" });
  expect([302, 303]).toContain(verified.status);
  return signInExisting(address);
}
async function disableIdentity(address: string) {
  const child = Bun.spawn([
    "docker", "compose", "--env-file", ".env", "run", "--rm", "--no-deps",
    "-e", `CENTRAL_IDENTITY_EMAIL=${address}`,
    "auth", "bun", "run", "disable:central-identity",
  ], {
    cwd: import.meta.dir + "/..",
    stdout: "ignore",
    stderr: "pipe",
  });
  const exitCode = await child.exited;
  if (exitCode !== 0) throw new Error(await new Response(child.stderr).text());
}

describe("central identity public HTTP behavior", () => {
  test("publishes canonical OIDC discovery and public signing keys", async () => {
    const discovery = await fetch(`${provider}/api/auth/.well-known/openid-configuration`);
    expect(discovery.status).toBe(200);
    const metadata = await discovery.json();
    expect(metadata.issuer).toBe(`${provider}/api/auth`);
    expect(metadata.authorization_endpoint).toBe(`${provider}/api/auth/oauth2/authorize`);
    expect(metadata.token_endpoint).toBe(`${provider}/api/auth/oauth2/token`);
    expect(metadata.jwks_uri).toBe(`${provider}/api/auth/jwks`);
    const keys = await fetch(metadata.jwks_uri);
    expect(keys.status).toBe(200);
    expect((await keys.json()).keys.length).toBeGreaterThan(0);
  });

  test("rejects unknown clients, unregistered redirects, and dynamic registration", async () => {
    const unknown = await fetch(`${provider}/api/auth/oauth2/authorize?response_type=code&client_id=unknown&redirect_uri=https%3A%2F%2Fevil.example%2Fcallback&scope=openid&state=state&code_challenge=challenge&code_challenge_method=S256`, { redirect: "manual" });
    expect(unknown.ok).toBe(false);
    const unknownLocation = unknown.headers.get("location");
    if (unknownLocation) {
      const destination = new URL(unknownLocation);
      expect(destination.origin).toBe(new URL(provider).origin);
      expect(destination.searchParams.get("error")).toBe("invalid_client");
      expect(destination.searchParams.has("code")).toBe(false);
    } else {
      expect(unknown.status).toBeGreaterThanOrEqual(400);
      expect(await unknown.text()).toContain("invalid_client");
    }

    const registration = await fetch(`${provider}/api/auth/oauth2/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ redirect_uris: ["https://evil.example/callback"] }),
    });
    expect([403, 404, 405]).toContain(registration.status);
  });

  test("anonymous requests cannot create OAuth clients", async () => {
    const response = await fetch(`${provider}/api/auth/oauth2/create-client`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ redirect_uris: ["https://evil.example/callback"] }),
    });
    expect([401, 403]).toContain(response.status);
  });
  test("enforces registered redirects, S256 PKCE, single-use codes, and ordinary-user client denial", async () => {
    const clientId = process.env.BIDDING_OIDC_CLIENT_ID;
    const clientSecret = process.env.BIDDING_OIDC_CLIENT_SECRET;
    expect(clientId).toBeTruthy();
    expect(clientSecret).toBeTruthy();
    const redirectURI = "https://bidding.127.0.0.1.sslip.io/api/auth/callback/central-identity";
    const cookie = await signIn(`oidc-${crypto.randomUUID()}@example.test`);
    const authorize = async (verifier: string) => {
      const challengeBytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
      const challenge = btoa(String.fromCharCode(...new Uint8Array(challengeBytes)))
        .replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
      const state = crypto.randomUUID();
      const nonce = crypto.randomUUID();
      const query = new URLSearchParams({
        response_type: "code",
        client_id: clientId!,
        redirect_uri: redirectURI,
        scope: "openid email profile",
        state,
        nonce,
        code_challenge: challenge,
        code_challenge_method: "S256",
      });
      const response = await fetch(`${provider}/api/auth/oauth2/authorize?${query}`, {
        headers: { cookie },
        redirect: "manual",
      });
      expect([302, 303]).toContain(response.status);
      const destination = new URL(response.headers.get("location")!);
      expect(destination.origin + destination.pathname).toBe(redirectURI);
      expect(destination.searchParams.get("state")).toBe(state);
      expect(destination.searchParams.get("iss")).toBe(`${provider}/api/auth`);
      return destination.searchParams.get("code")!;
    };
    const exchange = (code: string, verifier: string) => fetch(`${provider}/api/auth/oauth2/token`, {
      method: "POST",
      headers: {
        authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectURI,
        code_verifier: verifier,
      }),
    });

    const firstVerifier = crypto.randomUUID() + crypto.randomUUID();
    const firstCode = await authorize(firstVerifier);
    const token = await exchange(firstCode, firstVerifier);
    expect(token.status).toBe(200);
    const tokenBody = await token.json();
    expect(tokenBody.id_token).toBeTruthy();
    const replay = await exchange(firstCode, firstVerifier);
    expect(replay.status).toBe(400);
    expect(await replay.text()).toContain("invalid_grant");

    const secondVerifier = crypto.randomUUID() + crypto.randomUUID();
    const secondCode = await authorize(secondVerifier);
    const wrongProof = await exchange(secondCode, crypto.randomUUID() + crypto.randomUUID());
    expect(wrongProof.status).toBe(400);
    expect(await wrongProof.text()).toContain("invalid_grant");

    const badRedirect = await fetch(`${provider}/api/auth/oauth2/authorize?${new URLSearchParams({
      response_type: "code",
      client_id: clientId!,
      redirect_uri: "https://evil.example/callback",
      scope: "openid",
      state: crypto.randomUUID(),
      nonce: crypto.randomUUID(),
      code_challenge: "challenge",
      code_challenge_method: "S256",
    })}`, { headers: { cookie }, redirect: "manual" });
    expect(badRedirect.ok).toBe(false);
    const badRedirectLocation = badRedirect.headers.get("location");
    if (badRedirectLocation) {
      const destination = new URL(badRedirectLocation);
      expect(destination.origin).toBe(new URL(provider).origin);
      expect(destination.searchParams.get("error")).toBeTruthy();
      expect(destination.searchParams.has("code")).toBe(false);
      expect(destination.href).not.toContain("evil.example");
    } else {
      expect(badRedirect.status).toBeGreaterThanOrEqual(400);
      const body = await badRedirect.text();
      expect(body).toContain("invalid");
      expect(body).not.toContain("evil.example");
    }

    const deniedActions = [
      fetch(`${provider}/api/auth/oauth2/create-client`, { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ redirect_uris: [redirectURI] }) }),
      fetch(`${provider}/api/auth/oauth2/get-clients`, { headers: { cookie } }),
      fetch(`${provider}/api/auth/oauth2/get-client?client_id=${clientId}`, { headers: { cookie } }),
      fetch(`${provider}/api/auth/oauth2/update-client`, { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ client_id: clientId, update: { redirect_uris: [redirectURI] } }) }),
      fetch(`${provider}/api/auth/oauth2/client/rotate-secret`, { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ client_id: clientId }) }),
      fetch(`${provider}/api/auth/oauth2/delete-client`, { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ client_id: clientId }) }),
    ];
    for (const action of await Promise.all(deniedActions)) {
      expect([401, 403]).toContain(action.status);
    }
  }, 60_000);

  test("operator disable revokes issued grants and Central SSO sessions", async () => {
    const clientId = process.env.BIDDING_OIDC_CLIENT_ID;
    const clientSecret = process.env.BIDDING_OIDC_CLIENT_SECRET;
    expect(clientId).toBeTruthy();
    expect(clientSecret).toBeTruthy();
    const address = `disabled-${crypto.randomUUID()}@example.test`;
    const cookie = await signIn(address);
    const redirectURI = "https://bidding.127.0.0.1.sslip.io/api/auth/callback/central-identity";
    const verifier = crypto.randomUUID() + crypto.randomUUID();
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
    const challenge = btoa(String.fromCharCode(...new Uint8Array(digest)))
      .replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
    const query = new URLSearchParams({
      response_type: "code",
      client_id: clientId!,
      redirect_uri: redirectURI,
      scope: "openid email profile",
      state: crypto.randomUUID(),
      nonce: crypto.randomUUID(),
      code_challenge: challenge,
      code_challenge_method: "S256",
    });
    const issued = await fetch(`${provider}/api/auth/oauth2/authorize?${query}`, {
      headers: { cookie },
      redirect: "manual",
    });
    expect([302, 303]).toContain(issued.status);
    const code = new URL(issued.headers.get("location")!).searchParams.get("code");
    expect(code).toBeTruthy();

    await disableIdentity(address);
    const exchange = await fetch(`${provider}/api/auth/oauth2/token`, {
      method: "POST",
      headers: {
        authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: code!,
        redirect_uri: redirectURI,
        code_verifier: verifier,
      }),
    });
    expect(exchange.ok).toBe(false);
    expect(exchange.status).toBeGreaterThanOrEqual(400);
    const exchangeBody = await exchange.text();
    expect(exchangeBody).not.toContain("access_token");
    expect(exchangeBody).not.toContain("id_token");

    const revokedSession = await fetch(`${provider}/api/auth/get-session`, { headers: { cookie } });
    expect(await revokedSession.json()).toBeNull();

    const freshCookie = await signInExisting(address);
    const denied = await fetch(`${provider}/api/auth/oauth2/authorize?${query}`, {
      headers: { cookie: freshCookie },
      redirect: "manual",
    });
    expect(denied.status).toBe(403);
    expect(denied.headers.get("location") ?? "").not.toContain("code=");
  }, 60_000);


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
