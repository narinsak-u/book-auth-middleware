export async function verifyProviderAccount(provider: "google" | "github", token: string) {
  if (provider === "google") {
    const response = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
      headers: { authorization: `Bearer ${token}` },
    });
    if (!response.ok) throw new Error("Google provider proof could not be verified.");
    const profile = await response.json() as { sub?: unknown; email?: unknown; email_verified?: unknown; name?: unknown };
    if (typeof profile.sub !== "string" || !/^[A-Za-z0-9_-]{1,255}$/.test(profile.sub)
      || typeof profile.email !== "string" || !profile.email.trim() || profile.email_verified !== true) {
      throw new Error("Google account does not prove control of a verified email.");
    }
    return {
      accountId: profile.sub,
      email: profile.email,
      name: typeof profile.name === "string" ? profile.name : "(name unavailable)",
    };
  }
  const headers = { authorization: `Bearer ${token}`, accept: "application/vnd.github+json" };
  const [profileResponse, emailsResponse] = await Promise.all([
    fetch("https://api.github.com/user", { headers }),
    fetch("https://api.github.com/user/emails", { headers }),
  ]);
  if (!profileResponse.ok || !emailsResponse.ok) throw new Error("GitHub provider proof could not be verified.");
  const profile = await profileResponse.json() as { id?: unknown; login?: unknown; name?: unknown };
  const emails = await emailsResponse.json() as unknown;
  const primary = Array.isArray(emails) ? emails.find((entry) => entry && typeof entry.email === "string"
    && entry.email.trim() && entry.primary === true && entry.verified === true) : undefined;
  if (!Number.isSafeInteger(profile.id) || Number(profile.id) <= 0 || !primary) {
    throw new Error("GitHub account does not prove control of a verified email.");
  }
  return {
    accountId: String(profile.id),
    email: primary.email as string,
    name: typeof profile.name === "string" ? profile.name
      : typeof profile.login === "string" ? profile.login : "(name unavailable)",
  };
}
