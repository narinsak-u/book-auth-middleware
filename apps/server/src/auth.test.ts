import { describe, expect, test } from "bun:test";

const provider = process.env.TEST_PROVIDER_URL;
const mailpit = process.env.TEST_MAILPIT_URL;
const relyingPartyClientId = process.env.TEST_RP_CLIENT_ID;
const relyingPartyRedirectUri = process.env.TEST_RP_REDIRECT_URI;
const retargetProvider = process.env.TEST_RETARGET_PROVIDER_URL;
const retargetDatabase = process.env.TEST_RETARGET_DATABASE_URL;
const retargetTarget = process.env.TEST_RETARGET_TARGET;
const retargetClientId = process.env.TEST_RETARGET_CLIENT_ID;
const retargetClientSecret = process.env.TEST_RETARGET_CLIENT_SECRET;
const oldSignInRedirect = process.env.TEST_RETARGET_OLD_SIGN_IN_REDIRECT_URI;
const oldRecoveryRedirect = process.env.TEST_RETARGET_OLD_RECOVERY_REDIRECT_URI;
const canTestRetarget = Boolean(
  retargetProvider && retargetDatabase && retargetTarget && retargetClientId &&
  retargetClientSecret && oldSignInRedirect && oldRecoveryRedirect,
);

describe.skipIf(!provider)("Central Identity public HTTP behavior", () => {

  test.skipIf(!mailpit)("requests password resets without disclosing account existence and rejects replay", async () => {
    const username = `recovery_${crypto.randomUUID().slice(0, 8)}`;
    const email = `${crypto.randomUUID()}@example.test`;
    const password = "verified-password-123";
    const signup = await authPost("sign-up/email", {
      name: "Recovery User",
      username,
      email,
      password,
    });
    expect(signup.status).toBe(200);
    const inbox = await fetch(`${mailpit}/api/v1/messages?query=to:${encodeURIComponent(email)}`);
    const verificationMessage = (await inbox.json()).messages[0];
    const verification = await fetch(`${mailpit}/api/v1/message/${verificationMessage.ID}`);
    const verificationURL = (await verification.json()).Text.match(/https?:\/\/[^\s<>"]+/)?.[0];
    expect(typeof verificationURL).toBe("string");
    await fetch(verificationURL!, { redirect: "manual" });

    const returnTo = "/sign-in?oauth_query=client_id%3Dtrusted%26sig%3Dsigned";
    const redirectTo = `${provider}/reset-password?returnTo=${encodeURIComponent(returnTo)}`;
    const requestReset = (address: string) => authPost("request-password-reset", {
      email: address,
      redirectTo,
    });
    const existingRequest = await requestReset(email);
    const missingRequest = await requestReset(`${crypto.randomUUID()}@example.test`);
    expect(existingRequest.status).toBe(missingRequest.status);
    expect(await existingRequest.text()).toBe(await missingRequest.text());

    const priorSession = await authPost("sign-in/email", { email, password });
    expect(priorSession.status).toBe(200);
    const sessionCookie = priorSession.headers.get("set-cookie")?.split(";")[0];
    expect(sessionCookie).toContain("session_token=");

    const resetInbox = await fetch(`${mailpit}/api/v1/messages?query=to:${encodeURIComponent(email)}`);
    const resetMessage = (await resetInbox.json()).messages[0];
    const resetMail = await fetch(`${mailpit}/api/v1/message/${resetMessage.ID}`);
    const resetURL = (await resetMail.json()).Text.match(/https?:\/\/[^\s<>"]+/)?.[0];
    expect(typeof resetURL).toBe("string");
    const redirect = await fetch(resetURL!, { redirect: "manual" });
    const resetPage = new URL(redirect.headers.get("location")!);
    const token = resetPage.searchParams.get("token");
    if (!token) throw new Error("Password reset email had no token");
    expect(resetPage.searchParams.get("returnTo")).toBe(returnTo);
    expect(resetPage.origin).toBe(provider!);

    const reset = (newPassword: string) => authPost("reset-password", { token, newPassword });
    expect((await reset("new-verified-password-456")).status).toBe(200);
    expect((await reset("replayed-password-789")).status).toBeGreaterThanOrEqual(400);
    const revokedSession = await fetch(`${provider}/api/auth/get-session`, {
      headers: { cookie: sessionCookie! },
    });
    expect(await revokedSession.json()).toBeNull();
    expect((await authPost("sign-in/email", { email, password })).status).toBeGreaterThanOrEqual(400);
    expect((await authPost("sign-in/email", { email, password: "new-verified-password-456" })).status).toBe(200);
  });

  test("rejects invalid reset tokens through the public HTTP API", async () => {
    const response = await authPost("reset-password", {
      token: crypto.randomUUID(),
      newPassword: "new-verified-password-456",
    });
    expect(response.status).toBeGreaterThanOrEqual(400);
  });

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


  test.skipIf(!relyingPartyClientId || !relyingPartyRedirectUri)(
    "restores only a registered relying-party origin after authorization state expires",
    async () => {
      const query = new URLSearchParams({
        client_id: relyingPartyClientId!,
        redirect_uri: relyingPartyRedirectUri!,
      });
      const restored = await fetch(`${provider}/api/auth/relying-party-destination?${query}`);
      expect(restored.status).toBe(200);
      expect(await restored.json()).toEqual({ destination: new URL(relyingPartyRedirectUri!).origin });

      query.set("redirect_uri", "https://attacker.example/callback");
      const rejected = await fetch(`${provider}/api/auth/relying-party-destination?${query}`);
      expect(rejected.status).toBe(400);
      expect(await rejected.json()).toEqual({ destination: null });
    },
  );
  test("keeps public OIDC discovery and readiness available", async () => {
    const discovery = await fetch(`${provider}/api/auth/.well-known/openid-configuration`);
    expect(discovery.status).toBe(200);
    expect((await discovery.json()).issuer).toBe(`${provider}/api/auth`);
    expect((await fetch(`${provider}/health/ready`)).status).toBe(200);
  });
});
describe.skipIf(!canTestRetarget)("OAuth client retarget integration", () => {
  test(
    "retargets a disposable OAuth client through the CLI and public callback behavior",
    async () => {
      if (retargetDatabase === process.env.DATABASE_URL) {
        throw new Error("TEST_RETARGET_DATABASE_URL must be separate from DATABASE_URL");
      }
      if (retargetTarget !== "bidding" && retargetTarget !== "reading") {
        throw new Error("TEST_RETARGET_TARGET must be bidding or reading");
      }
      const clientIdVariable = retargetTarget === "bidding"
        ? "BIDDING_OIDC_CLIENT_ID"
        : "READING_OIDC_CLIENT_ID";
      const checkDestination = async (redirectUri: string) => {
        const query = new URLSearchParams({ client_id: retargetClientId!, redirect_uri: redirectUri });
        return fetch(`${retargetProvider}/api/auth/relying-party-destination?${query}`);
      };
      const runRetarget = (signIn: string, recovery: string) => Bun.spawnSync({
        cmd: ["bun", "src/retarget-oauth-client.ts", retargetTarget!],
        cwd: `${import.meta.dir}/..`,
        stdout: "pipe",
        stderr: "pipe",
        env: {
          ...process.env,
          DATABASE_URL: retargetDatabase!,
          [clientIdVariable]: retargetClientId!,
          OIDC_SIGN_IN_REDIRECT_URI: signIn,
          OIDC_RECOVERY_REDIRECT_URI: recovery,
        },
      });
      const newOrigin = `https://retarget-${crypto.randomUUID()}.example.test`;
      const newSignIn = `${newOrigin}/api/auth/callback/central-identity`;
      const newRecovery = `${newOrigin}/api/identity-recovery/callback`;
      let retargeted = false;

      try {
        const updated = runRetarget(newSignIn, newRecovery);
        expect(updated.exitCode).toBe(0);
        retargeted = true;

        for (const redirectUri of [newSignIn, newRecovery]) {
          const accepted = await checkDestination(redirectUri);
          expect(accepted.status).toBe(200);
          expect(await accepted.json()).toEqual({ destination: newOrigin });
        }
        const discovery = await fetch(`${retargetProvider}/api/auth/.well-known/openid-configuration`);
        const { token_endpoint: tokenEndpoint } = await discovery.json() as { token_endpoint: string };
        const authenticatedWithoutCode = await fetch(tokenEndpoint, {
          method: "POST",
          headers: {
            authorization: `Basic ${btoa(`${encodeURIComponent(retargetClientId!)}:${encodeURIComponent(retargetClientSecret!)}`)}`,
            "content-type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams({
            grant_type: "authorization_code",
            code: "invalid-retarget-test-code",
            redirect_uri: newSignIn,
          }),
        });
        expect(authenticatedWithoutCode.status).toBe(400);
        expect(await authenticatedWithoutCode.json()).toMatchObject({ error: "invalid_grant" });
        for (const redirectUri of [oldSignInRedirect!, oldRecoveryRedirect!]) {
          const rejected = await checkDestination(redirectUri);
          expect(rejected.status).toBe(400);
          expect(await rejected.json()).toEqual({ destination: null });
        }

        const invalid = runRetarget(
          `${newOrigin}/api/auth/callback/central-identity`,
          "https://other.example.test/api/identity-recovery/callback",
        );
        expect(invalid.exitCode).not.toBe(0);
        const unchanged = await checkDestination(newSignIn);
        expect(unchanged.status).toBe(200);
        expect(await unchanged.json()).toEqual({ destination: newOrigin });
      } finally {
        if (retargeted) {
          expect(runRetarget(oldSignInRedirect!, oldRecoveryRedirect!).exitCode).toBe(0);
        }
      }
    },
  );
});
