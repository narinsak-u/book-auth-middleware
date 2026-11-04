import { eq } from "drizzle-orm";
import { Elysia } from "elysia";
import { auth } from "./auth";
import { databaseReady, db } from "./db";
import { user } from "./schema";


const page = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Central Identity</title>
  <style>
    body{font:16px system-ui,sans-serif;max-width:34rem;margin:3rem auto;padding:0 1rem;color:#172033}
    main{border:1px solid #d8deea;border-radius:12px;padding:2rem}
    label{display:block;margin:1rem 0 .3rem}
    input{box-sizing:border-box;width:100%;padding:.7rem;border:1px solid #aeb8c8;border-radius:6px}
    button{margin-top:1rem;padding:.7rem 1rem;border:0;border-radius:6px;background:#244ca0;color:white;cursor:pointer}
    #status{min-height:1.5rem}
  </style>
</head>
<body>
<main>
  <h1>Central Identity</h1>
  <p id="status" role="status" aria-live="polite"></p>
  <form id="register">
    <h2>Create a test identity</h2>
    <label for="name">Name</label><input id="name" name="name" autocomplete="name" required>
    <label for="register-email">Email</label><input id="register-email" name="email" type="email" autocomplete="email" required>
    <label for="register-password">Password</label><input id="register-password" name="password" type="password" autocomplete="new-password" minlength="8" required>
    <button>Create account</button>
  </form>
  <form id="signin">
    <h2>Sign in</h2>
    <label for="signin-email">Email</label><input id="signin-email" name="email" type="email" autocomplete="email" required>
    <label for="signin-password">Password</label><input id="signin-password" name="password" type="password" autocomplete="current-password" required>
    <button>Sign in</button>
  </form>
  <form id="forgot-password">
    <h2>Forgot your password?</h2>
    <label for="recovery-email">Email</label><input id="recovery-email" name="email" type="email" autocomplete="email" required>
    <button>Send reset link</button>
  </form>
  <form id="reset-password" hidden>
    <h2>Choose a new password</h2>
    <label for="new-password">New password</label><input id="new-password" name="newPassword" type="password" autocomplete="new-password" minlength="8" required>
    <button>Reset password</button>
  </form>
  <p id="logout-explanation" hidden>Central sign-out ends your Central SSO Session only. Existing Book Bidding and Read in Peace Application Sessions remain active until you sign out in each app or they expire.</p>
  <button id="signout" hidden>Sign out of Central Identity</button>
</main>
<script>
const status = document.querySelector("#status");
const message = new URLSearchParams(location.search);
const resetToken = message.get("token");
document.querySelector("#reset-password").hidden = !resetToken;
if (message.get("error") === "INVALID_TOKEN") status.textContent = "This reset link is invalid or expired. Request a new one.";
else if (message.has("error")) status.textContent = "Email verification failed. Request a new message or try again.";
else if (message.has("verified")) status.textContent = "Email verified. You can now sign in.";
async function submit(form, endpoint) {
  const values = Object.fromEntries(new FormData(form));
  const oauthQuery = new URLSearchParams(location.search).get("oauth_query");
  const body = endpoint === "request-password-reset"
    ? { ...values, redirectTo: location.origin }
    : endpoint === "reset-password"
      ? { ...values, token: resetToken }
      : { ...values, callbackURL: location.href, ...(oauthQuery ? { oauth_query: oauthQuery } : {}) };
  const response = await fetch("/api/auth/" + endpoint, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    status.textContent = endpoint === "sign-in/email" && response.status === 403
      ? "Verify your email using the message sent to your inbox before signing in."
      : endpoint === "reset-password"
        ? "This reset link is invalid or expired. Request a new one."
        : "Request failed. Check the details and try again.";
    return;
  }
  if (endpoint === "sign-up/email") {
    status.textContent = "Check the local test inbox for your verification link.";
  } else if (endpoint === "request-password-reset") {
    status.textContent = "If an account matches that email, a reset link will be sent.";
  } else if (endpoint === "reset-password") {
    status.textContent = "Password updated. You can now sign in.";
  } else {
    status.textContent = "Signed in.";
    if (message.has("sig") && message.has("client_id")) location.assign("/api/auth/oauth2/authorize" + location.search);
    else if (result.url) location.assign(result.url);
    else if (oauthQuery) location.reload();
    else await refreshSession();
  }
}
document.querySelector("#register").addEventListener("submit", event => {
  event.preventDefault(); submit(event.currentTarget, "sign-up/email");
});
document.querySelector("#signin").addEventListener("submit", event => {
  event.preventDefault(); submit(event.currentTarget, "sign-in/email");
});
document.querySelector("#forgot-password").addEventListener("submit", event => {
  event.preventDefault(); submit(event.currentTarget, "request-password-reset");
});
document.querySelector("#reset-password").addEventListener("submit", event => {
  event.preventDefault(); submit(event.currentTarget, "reset-password");
});
async function refreshSession() {
  const response = await fetch("/api/auth/get-session");
  const data = await response.json();
  if (data?.user) {
    status.textContent = "Signed in as " + data.user.email;
    document.querySelector("#signout").hidden = false;
    document.querySelector("#logout-explanation").hidden = false;
  }
}
document.querySelector("#signout").addEventListener("click", async () => {
  const response = await fetch("/api/auth/sign-out", { method: "POST" });
  if (!response.ok) {
    status.textContent = "Central sign-out failed. Try again.";
    return;
  }
  document.querySelector("#signout").hidden = true;
  document.querySelector("#logout-explanation").hidden = true;
  status.textContent = "Central SSO Session ended. Existing Application Sessions remain active in Book Bidding and Read in Peace.";
});
refreshSession();
</script>
</body>
</html>`;

const app = new Elysia()
  .onRequest(async ({ request }) => {
    if (new URL(request.url).pathname !== "/api/auth/oauth2/authorize") return;
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session) return;
    const [identity] = await db
      .select({ disabled: user.disabled })
      .from(user)
      .where(eq(user.id, session.user.id))
      .limit(1);
    if (identity?.disabled) {
      return new Response("Central Identity is disabled", { status: 403 });
    }
  })
  .onAfterHandle(({ request, response }) => {
    if (!(response instanceof Response)) return;
    const pathname = new URL(request.url).pathname;
    if (pathname === "/api/auth/sign-in/email") {
      console.info(JSON.stringify({
        event: response.ok ? "authentication.success" : "authentication.failure",
        action: "password_sign_in",
        status: response.status,
      }));
      return;
    }
    if (pathname !== "/api/auth/oauth2/authorize" || response.status < 300 || response.status >= 400) return;
    const destination = response.headers.get("location");
    if (!destination || !new URL(destination, request.url).searchParams.has("code")) return;
    console.info(JSON.stringify({
      event: "authentication.success",
      action: "oidc_authorization",
      status: response.status,
    }));
  })
  .get("/", () => new Response(page, { headers: { "content-type": "text/html; charset=utf-8" } }))
  .get("/health/live", () => ({ status: "live" }))
  .get("/health/ready", async ({ set }) => {
    try {
      await databaseReady();
      return { status: "ready" };
    } catch {
      set.status = 503;
      return { status: "not_ready" };
    }
  })
  .mount(auth.handler)
  .listen({ hostname: "0.0.0.0", port: Number(process.env.PORT ?? 3000) });

console.log(`Central Identity listening on ${app.server?.hostname}:${app.server?.port}`);
