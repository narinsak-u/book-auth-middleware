export type AuthorizationResume = { clientId: string; redirectUri: string };

export function authorizationResume(query: string | null): AuthorizationResume | undefined {
  if (!query) return undefined;
  const params = new URLSearchParams(query);
  const clientId = params.get("client_id");
  const redirectUri = params.get("redirect_uri");
  if (!clientId || !redirectUri) return undefined;
  return { clientId, redirectUri };
}

export function resumeSignInPath(resume: AuthorizationResume | undefined): string {
  if (!resume) return "/sign-in";
  const params = new URLSearchParams({ resume_client_id: resume.clientId, resume_redirect_uri: resume.redirectUri });
  return `/sign-in?${params}`;
}

export function verificationCallback(origin: string, resume: AuthorizationResume | undefined): string {
  const callback = new URL("/sign-in", origin);
  callback.searchParams.set("verified", "1");
  if (resume) {
    callback.searchParams.set("resume_client_id", resume.clientId);
    callback.searchParams.set("resume_redirect_uri", resume.redirectUri);
  }
  return callback.toString();
}
