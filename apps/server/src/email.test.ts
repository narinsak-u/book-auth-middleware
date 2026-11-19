import { expect, test } from "bun:test";
import { createEmailSender } from "./email";

const mailpit = {
  EMAIL_PROVIDER: "mailpit",
  EMAIL_FROM: "Central Identity <identity@localhost>",
  SMTP_HOST: "127.0.0.1",
  SMTP_PORT: "1025",
};

test("uses unauthenticated SMTP for explicit development Mailpit", () => {
  const send = createEmailSender(mailpit, false);
  expect(typeof send).toBe("function");
});

test("keeps authenticated SMTP for real production", () => {
  const send = createEmailSender({
    EMAIL_PROVIDER: "smtp",
    EMAIL_FROM: "Identity <identity@example.test>",
    SMTP_HOST: "smtp.example.test",
    SMTP_PORT: "587",
    SMTP_USER: "synthetic-user",
    SMTP_PASSWORD: "synthetic-password",
  }, true);
  expect(typeof send).toBe("function");
});

test("rejects missing and profile-mismatched email providers at startup", () => {
  expect(() => createEmailSender({ ...mailpit, EMAIL_PROVIDER: undefined }, false)).toThrow();
  expect(() => createEmailSender({ ...mailpit, EMAIL_PROVIDER: "smtp" }, false)).toThrow();
  expect(() => createEmailSender({ ...mailpit, EMAIL_PROVIDER: "mailpit" }, true)).toThrow();
  expect(() => createEmailSender({ ...mailpit, EMAIL_PROVIDER: "resend" }, true)).toThrow();
});
