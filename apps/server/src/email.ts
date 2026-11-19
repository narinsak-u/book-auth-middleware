import nodemailer from "nodemailer";

type Environment = Record<string, string | undefined>;
type Message = { to: string; subject: string; text: string };

const required = (environment: Environment, name: string): string => {
  const value = environment[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
};

export function createEmailSender(environment: Environment, productionRuntime: boolean) {
  const provider = required(environment, "EMAIL_PROVIDER");
  const expectedProvider = productionRuntime ? "smtp" : "mailpit";
  if (provider !== expectedProvider) {
    throw new Error(`EMAIL_PROVIDER must be ${expectedProvider} for this runtime`);
  }

  const port = Number(required(environment, "SMTP_PORT"));
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("SMTP_PORT must be a valid TCP port");
  }
  const mailer = nodemailer.createTransport({
    host: required(environment, "SMTP_HOST"),
    port,
    secure: port === 465,
    requireTLS: productionRuntime && port !== 465,
    ...(productionRuntime ? {
      auth: {
        user: required(environment, "SMTP_USER"),
        pass: required(environment, "SMTP_PASSWORD"),
      },
    } : {}),
  });
  const from = required(environment, "EMAIL_FROM");

  return async ({ to, subject, text }: Message): Promise<void> => {
    try {
      await mailer.sendMail({ from, to, subject, text });
    } catch {
      throw new Error("Email delivery failed");
    }
  };
}
