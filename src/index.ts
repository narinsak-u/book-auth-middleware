import { Elysia } from "elysia";
import { auth } from "./auth";
import { databaseReady } from "./db";

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
  <button id="signout" hidden>Sign out</button>
</main>
<script>
const status = document.querySelector("#status");
const message = new URLSearchParams(location.search);
if (message.has("error")) status.textContent = "Email verification failed. Request a new message or try again.";
else if (message.has("verified")) status.textContent = "Email verified. You can now sign in.";
async function submit(form, endpoint) {
  const values = Object.fromEntries(new FormData(form));
  const oauthQuery = new URLSearchParams(location.search).get("oauth_query");
  const response = await fetch("/api/auth/" + endpoint, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...values, callbackURL: location.href, ...(oauthQuery ? { oauth_query: oauthQuery } : {}) })
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    status.textContent = endpoint === "sign-in/email" && response.status === 403
      ? "Verify your email using the message sent to your inbox before signing in."
      : "Request failed. Check the details and try again.";
    return;
  }
  if (endpoint === "sign-up/email") {
    status.textContent = "Check the local test inbox for your verification link.";
  } else {
    status.textContent = "Signed in.";
    if (result.url) location.assign(result.url);
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
async function refreshSession() {
  const response = await fetch("/api/auth/get-session");
  const data = await response.json();
  if (data?.user) {
    status.textContent = "Signed in as " + data.user.email;
    document.querySelector("#signout").hidden = false;
  }
}
document.querySelector("#signout").addEventListener("click", async () => {
  await fetch("/api/auth/sign-out", { method: "POST" });
  document.querySelector("#signout").hidden = true;
  status.textContent = "Signed out.";
});
refreshSession();
</script>
</body>
</html>`;

const app = new Elysia()
  .onAfterHandle(({ request, response }) => {
    if (
      new URL(request.url).pathname === "/api/auth/sign-in/email" &&
      response instanceof Response &&
      !response.ok
    ) {
      console.info(JSON.stringify({
        event: "authentication.failure",
        action: "password_sign_in",
        status: response.status,
      }));
    }
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
