import { useState, type FormEvent, type ReactNode } from "react";
import { authClient } from "./auth-client";

function Shell({ children }: { children: ReactNode }) {
  return <main className="portal-shell"><header className="topbar"><a className="brand" href="/" aria-label="Central Identity home"><span className="brand-mark" aria-hidden="true">C</span><span>Central Identity</span></a><span className="secure-label">Account recovery</span></header><section className="recovery-panel">{children}</section></main>;
}

export function ForgotPassword() {
  const [pending, setPending] = useState(false);
  const [requested, setRequested] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const email = new FormData(event.currentTarget).get("email") as string;
    setPending(true);
    setError("");
    try {
      const result = await authClient.requestPasswordReset({ email, redirectTo: `${window.location.origin}/reset-password` });
      if (result.error) throw result.error;
      setRequested(true);
    } catch {
      setError("We couldn't process that request right now. Please try again.");
    } finally {
      setPending(false);
    }
  }

  return <Shell><p className="form-kicker">Password recovery</p><h1>Reset your password</h1><p className="form-intro">Enter your email address and we’ll send a reset link if an account matches.</p>{requested ? <p className="form-status" role="status">If an account matches that email address, a password reset link will arrive shortly.</p> : <form onSubmit={submit} aria-busy={pending}><label htmlFor="recovery-email">Email address</label><input id="recovery-email" name="email" type="email" autoComplete="email" required disabled={pending} />{error && <p className="form-error" role="alert">{error}</p>}<button className="button" type="submit" disabled={pending}>{pending ? "Sending reset link…" : "Send reset link"}</button></form>}<p className="recovery-back"><a href="/sign-in">Back to sign in</a></p></Shell>;
}

export function ResetPassword() {
  const token = typeof window === "undefined" ? "" : new URLSearchParams(window.location.search).get("token") ?? "";
  const [pending, setPending] = useState(false);
  const [complete, setComplete] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token) {
      setError("This reset link is invalid or has expired. Request a new link.");
      return;
    }
    const newPassword = new FormData(event.currentTarget).get("newPassword") as string;
    setPending(true);
    setError("");
    try {
      const result = await authClient.resetPassword({ newPassword, token });
      if (result.error) throw result.error;
      setComplete(true);
    } catch {
      setError("This reset link is invalid or has expired. Request a new link.");
    } finally {
      setPending(false);
    }
  }

  return <Shell><p className="form-kicker">Password recovery</p><h1>Choose a new password</h1>{complete ? <><p className="form-status" role="status">Your password has been changed. Sign in with your new password.</p><a className="button" href="/sign-in">Return to sign in</a></> : <><p className="form-intro">Choose a new password for your Central Identity.</p><form onSubmit={submit} aria-busy={pending}><label htmlFor="new-password">New password</label><input id="new-password" name="newPassword" type="password" autoComplete="new-password" minLength={8} required disabled={pending || !token} />{error && <p className="form-error" role="alert">{error}</p>}{!token && <p className="form-error" role="alert">This reset link is invalid or has expired. Request a new link.</p>}<button className="button" type="submit" disabled={pending || !token}>{pending ? "Updating password…" : "Set new password"}</button></form><p className="recovery-back"><a href="/forgot-password">Request another reset link</a> · <a href="/sign-in">Back to sign in</a></p></>}</Shell>;
}
