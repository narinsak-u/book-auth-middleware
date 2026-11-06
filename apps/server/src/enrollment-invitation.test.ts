import { describe, expect, test } from "bun:test";
import { allowCredentialSignup } from "./enrollment-invitation";

describe("credential signup policy", () => {
  test("keeps development signup open without invitations", async () => {
    const consumeInvitation = async () => false;
    await expect(allowCredentialSignup({
      productionRuntime: false,
      newUser: { email: "reader@example.test", username: "reader" },
      invitationToken: null,
      consumeInvitation,
    })).resolves.toBeUndefined();
  });
  test("requires and consumes valid invitations in production", async () => {
    const consumeInvitation = async (token: string, email: string) =>
      token === "valid-invitation" && email === "reader@example.test";
    const input = {
      productionRuntime: true,
      newUser: { email: "reader@example.test", username: "reader" },
      consumeInvitation,
    };
    await expect(allowCredentialSignup({ ...input, invitationToken: null })).resolves.toBe(false);
    await expect(allowCredentialSignup({ ...input, invitationToken: "invalid-invitation" })).resolves.toBe(false);
    await expect(allowCredentialSignup({ ...input, invitationToken: "valid-invitation" })).resolves.toBeUndefined();
  });

  test("rejects malformed credential registrations in both environments", async () => {
    const consumeInvitation = async () => true;
    await expect(allowCredentialSignup({
      productionRuntime: false,
      newUser: { email: "reader@example.test" },
      invitationToken: null,
      consumeInvitation,
    })).resolves.toBe(false);
  });
});
