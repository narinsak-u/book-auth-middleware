import { authClient } from "./auth-client";
import { useEffect, useState, type FormEvent } from "react";

type Session = { user: { email: string } } | null;

function Brand() {
  return <a className="brand" href="/" aria-label="Central Identity home"><span className="brand-mark" aria-hidden="true">C</span><span>Central Identity</span></a>;
}

function SignOut({ email }: { email: string }) {
  const [pending, setPending] = useState(false);
  const [ended, setEnded] = useState(false);
  const [message, setMessage] = useState("");
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

  useEffect(() => {
    authClient.getSession()
      .then(({ data }) => setSession(data?.user ? { user: { email: data.user.email } } : null))
      .catch(() => setSession(null));
  }, []);

  const params = typeof window === "undefined" ? null : new URLSearchParams(window.location.search);
  const isSignedAuthorizeRequest = params !== null && params.has("sig") && params.has("client_id");
  const oauthQuery = params?.get("oauth_query") ?? (isSignedAuthorizeRequest ? window.location.search.slice(1) : null);
  const hasAuthorizationRequest = oauthQuery !== null;
  const verificationError = params?.get("error") === "EMAIL_NOT_VERIFIED" || params?.get("error_description")?.toLowerCase().includes("email not verified");

  useEffect(() => {
    if (verificationError) setError("Verify your email using the message sent to your inbox before signing in.");
    else if (params?.has("error")) setError("This verification link is invalid or expired.");
    else if (params?.has("verified")) setNotice("Email verified. You can now sign in.");
  }, [verificationError]);
  useEffect(() => {
    if (mode === "home" && session === null) window.location.replace("/sign-in");
  }, [mode, session]);

  if (session?.user) return <main className="portal-shell"><header className="topbar"><Brand /><span className="secure-label"><span aria-hidden="true">●</span> Central SSO Session active</span></header><SignOut email={session.user.email} /></main>;
  if (mode === "home") return <main className="portal-shell"><header className="topbar"><Brand /></header><section className="loading-panel" role="status">{session === null ? "Opening sign-in…" : "Checking your Central SSO Session…"}</section></main>;

  async function submit(event: FormEvent<HTMLFormElement>) {
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
      if (error) {
        setError(error.status === 403 || error.code === "EMAIL_NOT_VERIFIED"
          ? "Verify your email using the message sent to your inbox before signing in."
          : "That email and password did not match. Check them and try again.");
        setPending(false);
        return;
      }
      if (hasAuthorizationRequest) {
        if (data.url) {
          window.location.assign(data.url);
          return;
        }
        if (isSignedAuthorizeRequest) {
          window.location.assign("/api/auth/oauth2/authorize" + window.location.search);
          return;
        }
        setError("Sign-in succeeded, but this application request could not be completed. Return to the application and try again.");
        setPending(false);
        return;
      }
      window.location.assign("/");
    } catch {
      setError("Sign-in could not reach Central Identity. Check your connection and try again.");
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
      <section className="form-panel" aria-labelledby="signin-title" hidden={session === undefined}>
        <p className="form-kicker">Welcome back</p>
        <h2 id="signin-title">Sign in to Central Identity</h2>
        <p className="form-intro">Use the email address and password for your Central Identity.</p>
        <form onSubmit={submit} aria-busy={pending}>
          <label htmlFor="email">Email address</label>
          <input id="email" name="email" type="email" autoComplete="email" required disabled={pending} />
          <label htmlFor="password">Password</label>
          <input id="password" name="password" type="password" autoComplete="current-password" required disabled={pending} />
          {notice && <p className="form-status" role="status">{notice}</p>}
          {error && <p className="form-error" role="alert">{error}</p>}
          <button className="button" type="submit" disabled={pending}>{pending ? "Signing in…" : "Sign in"}</button>
        </form>
        <div className="legacy-links"><p>Need to create an identity or reset your password?</p><p><a href="/sign-up">Create a Central Identity</a></p><a href="/legacy#register">Enrollment and recovery (temporary)</a></div>
        <p className="recovery-back"><a href="/forgot-password">Forgot your password?</a></p>
        {mode === "sign-in" && <p className="direct-note">Signing in directly keeps you here. A Relying Party will be resumed only when Better Auth provides a valid authorization request.</p>}
      </section>
    </div>
  </main>;
}
export function Enrollment() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [submitted, setSubmitted] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");
    const fields = new FormData(event.currentTarget);
    try {
      const { error } = await authClient.signUp.email({
        email: String(fields.get("email")),
        password: String(fields.get("password")),
        name: String(fields.get("name")),
        callbackURL: `${window.location.origin}/sign-in?verified=1`,
      });
      if (error) {
        setError("This identity could not be created. Check the details or try again later.");
      } else {
        setSubmitted(true);
      }
    } catch {
      setError("Enrollment could not reach Central Identity. Check your connection and try again.");
    } finally {
      setPending(false);
    }
  }

  return <main className="portal-shell">
    <header className="topbar"><Brand /><span className="secure-label">Local enrollment</span></header>
    <div className="signin-layout">
      <section className="welcome-panel" aria-labelledby="enrollment-welcome-title">
        <p className="welcome-kicker">A local Central Identity</p>
        <h1 id="enrollment-welcome-title">Create your identity.</h1>
        <p>Verify your email before using your password to sign in. A Central Identity does not grant access to either application.</p>
        <div className="privacy-mark" aria-hidden="true"><span></span><span></span><span></span></div>
      </section>
      <section className="form-panel" aria-labelledby="enrollment-title">
        <p className="form-kicker">New identity</p>
        <h2 id="enrollment-title">Sign up</h2>
        {submitted ? <p className="form-status" role="status">If enrollment succeeded, a verification message has been sent. Open the link in that email before signing in.</p> : <>
          <p className="form-intro">Create a local identity. Email verification is required before password sign-in.</p>
          <form onSubmit={submit} aria-busy={pending}>
            <label htmlFor="signup-name">Name</label>
            <input id="signup-name" name="name" type="text" autoComplete="name" required disabled={pending} />
            <label htmlFor="signup-email">Email address</label>
            <input id="signup-email" name="email" type="email" autoComplete="email" required disabled={pending} />
            <label htmlFor="signup-password">Password</label>
            <input id="signup-password" name="password" type="password" autoComplete="new-password" required disabled={pending} />
            {error && <p className="form-error" role="alert">{error}</p>}
            <button className="button" type="submit" disabled={pending}>{pending ? "Creating identity…" : "Create identity"}</button>
          </form>
        </>}
        <div className="legacy-links"><a href="/sign-in">Return to sign in</a></div>
      </section>
    </div>
  </main>;
}
