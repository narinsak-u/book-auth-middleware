import { authClient } from "./auth-client";
import { useEffect, useState, type FormEvent } from "react";

type Session = { user: { email: string } } | null;

function Brand() {
  return <a className="brand" href="/" aria-label="Central Identity home"><span className="brand-mark" aria-hidden="true">C</span><span>Central Identity</span></a>;
}

function SignOut({ email, allowLinking }: { email: string; allowLinking: boolean }) {
  const [pending, setPending] = useState(false);
  const [ended, setEnded] = useState(false);
  const [message, setMessage] = useState("");
  async function link(provider: "google" | "github") {
    setPending(true);
    try {
      const { error } = await authClient.linkSocial({ provider, callbackURL: "/" });
      if (error) throw error;
    } catch {
      setMessage("Provider link failed. Sign in to the provider account you want to add.");
      setPending(false);
    }
  }
  async function signOut() {
    setPending(true);
    setMessage("");
    try {
      const { error } = await authClient.signOut();
      if (error) throw error;
      setEnded(true);
      setMessage("Your Central SSO Session has ended. Existing Book Bidding and Read in Peace Application Sessions continue.");
    } catch {
      setPending(false);
      setMessage("Central sign-out could not be completed. Try again.");
    }
  }
  return <section className="session-panel" aria-labelledby="session-title">
    <span className="session-symbol" aria-hidden="true">{ended ? "✓" : "●"}</span>
    <h1 id="session-title">{ended ? "Central SSO Session ended" : "Your Central Identity is ready."}</h1>
    {!ended && <p className="signed-in-as">Signed in as <strong>{email}</strong></p>}
    {!ended && <p>Use this Central SSO Session to continue to a connected application. Each application keeps its own Application Session.</p>}
    {allowLinking && !ended && <div className="account-links"><p>Add another provider explicitly; email matching does not link accounts.</p><button className="button" type="button" onClick={() => link("google")} disabled={pending}>Link Google</button><button className="button button-secondary" type="button" onClick={() => link("github")} disabled={pending}>Link GitHub</button></div>}
    <div className="signout-note"><strong>Signing out here is central only.</strong><br />Existing Book Bidding and Read in Peace Application Sessions remain active until you sign out in each application or they expire.</div>
    {!ended && <button className="button button-secondary" type="button" onClick={signOut} disabled={pending}>{pending ? "Signing out…" : "Sign out of Central Identity"}</button>}
    <p role="status" aria-live="polite" className="form-status">{message}</p>
  </section>;
}

export function Portal({ mode }: { mode: "home" | "sign-in" }) {
  const [session, setSession] = useState<Session | undefined>();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [oauthFirst, setOauthFirst] = useState<boolean>();

  useEffect(() => {
    authClient.getSession()
      .then(({ data }) => setSession(data?.user ? { user: { email: data.user.email } } : null))
      .catch(() => setSession(null));
  }, []);
  useEffect(() => {
    fetch("/api/auth/config").then((response) => response.json()).then((config) => setOauthFirst(config.oauthFirst))
      .catch(() => setError("Central Identity configuration could not be loaded."));
  }, []);

  const params = typeof window === "undefined" ? null : new URLSearchParams(window.location.search);
  const isSignedAuthorizeRequest = params !== null && params.has("sig") && params.has("client_id");
  const oauthQuery = params?.get("oauth_query") ?? (isSignedAuthorizeRequest ? window.location.search.slice(1) : null);
  const hasAuthorizationRequest = oauthQuery !== null;
  const verificationError = params?.get("error") === "EMAIL_NOT_VERIFIED" || params?.get("error_description")?.toLowerCase().includes("email not verified");

  useEffect(() => {
    if (verificationError) setError("Use a verified provider email. GitHub users must grant access to a verified email address.");
    else if (params?.has("error")) setError("Sign-in was refused. Use the provider already linked to your identity; matching email never links accounts.");
    else if (params?.has("verified")) setNotice("Email verified. You can now sign in.");
  }, [verificationError]);
  useEffect(() => {
    if (mode === "home" && session === null) window.location.replace("/sign-in");
  }, [mode, session]);

  if (session?.user) return <main className="portal-shell"><header className="topbar"><Brand /><span className="secure-label"><span aria-hidden="true">●</span> Central SSO Session active</span></header><SignOut email={session.user.email} allowLinking={oauthFirst === true} /></main>;
  if (mode === "home") return <main className="portal-shell"><header className="topbar"><Brand /></header><section className="loading-panel" role="status">{session === null ? "Opening sign-in…" : "Checking your Central SSO Session…"}</section></main>;

  async function submitPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");
    const fields = new FormData(event.currentTarget);
    try {
      const { data, error } = await authClient.signIn.email({
        email: String(fields.get("email")),
        password: String(fields.get("password")),
        callbackURL: window.location.origin,
        ...(oauthQuery !== null ? { oauth_query: oauthQuery } : {}),
      });
      if (error) throw error;
      if (data?.url) window.location.assign(data.url);
      else window.location.assign("/");
    } catch {
      setError("That email and password did not match. Check them and try again.");
      setPending(false);
    }
  }
  async function signIn(provider: "google" | "github") {
    setPending(true);
    setError("");
    try {
      const { error } = await authClient.signIn.social({
        provider,
        callbackURL: hasAuthorizationRequest && oauthQuery
          ? `/api/auth/oauth2/authorize?${oauthQuery}`
          : "/",
      });
      if (error) throw error;
    } catch {
      setError("Sign-in failed. Use a provider account with verified email. If that email already has an identity, sign in with its linked provider; matching email never links accounts.");
      setPending(false);
    }
  }

  return <main className="portal-shell">
    <header className="topbar"><Brand /><span className="secure-label"><span aria-hidden="true">●</span> Secure sign-in</span></header>
    {session === undefined && <section className="loading-panel" role="status">Checking your Central SSO Session…</section>}
    <div className="signin-layout">
      <section className="welcome-panel" aria-labelledby="welcome-title">
        <p className="welcome-kicker">Your sign-in, in one place</p>
        <h1 id="welcome-title">One Central Identity.<br />Your applications stay yours.</h1>
        <p>Sign in to continue. Book Bidding and Read in Peace each keep their own Application Session and access rules.</p>
        <div className="privacy-mark" aria-hidden="true"><span></span><span></span><span></span></div>
      </section>
      <section className="form-panel" aria-labelledby="signin-title" hidden={session === undefined || oauthFirst === undefined}>
        <p className="form-kicker">Welcome</p>
        <h2 id="signin-title">{oauthFirst ? "Sign in or create an identity" : "Sign in to Central Identity"}</h2>
        {oauthFirst ? <p className="form-intro">Use Google or GitHub with a verified email. A matching address never links two provider accounts.</p> : <p className="form-intro">Use the email address and password for your Central Identity.</p>}
        {oauthFirst ? <>
          <button className="button" type="button" onClick={() => signIn("google")} disabled={pending}>{pending ? "Opening provider…" : "Continue with Google"}</button>
          <button className="button button-secondary" type="button" onClick={() => signIn("github")} disabled={pending}>Continue with GitHub</button>
          <p className="form-intro">GitHub users with private email must grant access to a verified email.</p>
        </> : <form onSubmit={submitPassword} aria-busy={pending}>
          <label htmlFor="email">Email address</label>
          <input id="email" name="email" type="email" autoComplete="email" required disabled={pending} />
          <label htmlFor="password">Password</label>
          <input id="password" name="password" type="password" autoComplete="current-password" required disabled={pending} />
          <button className="button" type="submit" disabled={pending}>{pending ? "Signing in…" : "Sign in"}</button>
        </form>}
        {notice && <p className="form-status" role="status">{notice}</p>}
        {error && <p className="form-error" role="alert">{error}</p>}
        {!oauthFirst && <div className="account-links"><a href="/sign-up">Create a Central Identity</a><p><a href="/forgot-password">Forgot your password?</a></p></div>}
        {mode === "sign-in" && <p className="direct-note">A Relying Party resumes only when Better Auth provides a valid authorization request.</p>}
      </section>
    </div>
  </main>;
}

export function Enrollment() {
  const [oauthFirst, setOauthFirst] = useState<boolean>();
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const invitation = typeof window === "undefined" ? "" : new URLSearchParams(window.location.search).get("invitation") ?? "";

  useEffect(() => {
    fetch("/api/auth/config").then((response) => response.json()).then((config) => {
      setOauthFirst(config.oauthFirst);
      if (config.oauthFirst) window.location.replace("/sign-in");
    });
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");
    const fields = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/auth/sign-up/email", {
        method: "POST",
        headers: { "content-type": "application/json", "x-enrollment-invitation": invitation },
        body: JSON.stringify({
          name: String(fields.get("name")),
          email: String(fields.get("email")),
          password: String(fields.get("password")),
          callbackURL: `${window.location.origin}/sign-in?verified=1`,
        }),
      });
      if (!response.ok) throw new Error("Enrollment failed");
      setSubmitted(true);
    } catch {
      setError("This invitation is invalid or expired. Ask an operator for a new invitation.");
    } finally {
      setPending(false);
    }
  }

  if (oauthFirst !== false) return <main className="portal-shell"><section className="loading-panel" role="status">Opening sign-in…</section></main>;
  return <main className="portal-shell"><section className="form-panel">
    <h1>Create a Central Identity</h1>
    {!invitation ? <p>Enrollment requires an operator invitation.</p> : submitted ? <p role="status">Check your email to verify your identity.</p> : <form onSubmit={submit} aria-busy={pending}>
      <label htmlFor="signup-name">Name</label><input id="signup-name" name="name" autoComplete="name" required disabled={pending} />
      <label htmlFor="signup-email">Email address</label><input id="signup-email" name="email" type="email" autoComplete="email" required disabled={pending} />
      <label htmlFor="signup-password">Password</label><input id="signup-password" name="password" type="password" autoComplete="new-password" required disabled={pending} />
      {error && <p className="form-error" role="alert">{error}</p>}
      <button className="button" type="submit" disabled={pending}>{pending ? "Creating identity…" : "Create identity"}</button>
    </form>}
    <a href="/sign-in">Return to sign in</a>
  </section></main>;
}

