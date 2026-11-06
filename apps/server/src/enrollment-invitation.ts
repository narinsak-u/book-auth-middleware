export async function allowCredentialSignup(input: {
  productionRuntime: boolean;
  newUser: { email?: unknown; username?: unknown };
  invitationToken: string | null | undefined;
  consumeInvitation: (token: string, email: string) => Promise<boolean>;
}): Promise<boolean | undefined> {
  if (input.productionRuntime) {
    if (!input.invitationToken || typeof input.newUser.email !== "string") return false;
    if (!await input.consumeInvitation(input.invitationToken, input.newUser.email)) return false;
  }
  return typeof input.newUser.username === "string" && input.newUser.username.length > 0
    ? undefined
    : false;
}
