import { expect, test } from "bun:test";
import { createEmailSender } from "./email";

const mailpit = {
  EMAIL_PROVIDER: "mailpit",
  EMAIL_FROM: "Central Identity <identity@localhost>",
  SMTP_HOST: "127.0.0.1",
  SMTP_PORT: "1025",
};

const resend = {
  EMAIL_PROVIDER: "resend",
  EMAIL_FROM: "Central Identity <identity@example.test>",
  RESEND_API_KEY: "synthetic-resend-key",
};

test("uses unauthenticated SMTP for explicit development Mailpit", () => {
  const send = createEmailSender(mailpit, false);
  expect(typeof send).toBe("function");
});

test("requires explicit Resend configuration for real production", () => {
  const send = createEmailSender(resend, true);
  expect(typeof send).toBe("function");
  expect(() => createEmailSender({ ...resend, EMAIL_PROVIDER: undefined }, true)).toThrow();
  expect(() => createEmailSender({ ...resend, EMAIL_PROVIDER: "mailpit" }, true)).toThrow();
  expect(() => createEmailSender({ ...resend, RESEND_API_KEY: undefined }, true)).toThrow();
  expect(() => createEmailSender({ ...resend, EMAIL_FROM: undefined }, true)).toThrow();
  expect(() => createEmailSender({ ...resend, EMAIL_PROVIDER: "smtp" }, true)).toThrow();
});

test("rejects mismatched Mailpit profiles", () => {
  expect(() => createEmailSender({ ...mailpit, EMAIL_PROVIDER: undefined }, false)).toThrow();
  expect(() => createEmailSender({ ...mailpit, EMAIL_PROVIDER: "resend" }, false)).toThrow();
  expect(() => createEmailSender({ ...mailpit, EMAIL_PROVIDER: "mailpit" }, true)).toThrow();
});

test("accepts one Resend submission", async () => {
  const submissions: unknown[] = [];
  const send = createEmailSender(resend, true, (apiKey) => {
    expect(apiKey).toBe(resend.RESEND_API_KEY);
    return {
      emails: { send: async (message) => { submissions.push(message); return { data: { id: "accepted" }, error: null }; } },
    };
  });
  await send({ to: "person@example.test", subject: "Verify", text: "Link" });
  expect(submissions).toEqual([{
    from: resend.EMAIL_FROM,
    to: "person@example.test",
    subject: "Verify",
    text: "Link",
  }]);
});

test("sanitizes Resend returned errors and never retries", async () => {
  let submissions = 0;
  const send = createEmailSender(resend, true, () => ({
    emails: { send: async () => { submissions++; return { data: null, error: { message: "private response" } }; } },
  }));
  await expect(send({ to: "person@example.test", subject: "Verify", text: "secret link" }))
    .rejects.toMatchObject({ message: "Email delivery failed" });
  expect(submissions).toBe(1);
});

test("sanitizes thrown Resend failures and never retries", async () => {
  let submissions = 0;
  const send = createEmailSender(resend, true, () => ({
    emails: { send: async () => { submissions++; throw new Error("private response"); } },
  }));
  await expect(send({ to: "person@example.test", subject: "Verify", text: "secret link" }))
    .rejects.toMatchObject({ message: "Email delivery failed" });
  expect(submissions).toBe(1);
});
