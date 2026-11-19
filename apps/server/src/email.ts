import nodemailer from "nodemailer";
import { Resend } from "resend";

type Environment = Record<string, string | undefined>;
type Message = { to: string; subject: string; text: string };
type ResendClient = {
  emails: {
    send(message: { from: string; to: string; subject: string; text: string }): Promise<{ error?: unknown }>;
  };
};
type ResendFactory = (apiKey: string) => ResendClient;

const required = (environment: Environment, name: string): string => {
  const value = environment[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
};

export function createEmailSender(
  environment: Environment,
  productionRuntime: boolean,
  createResend: ResendFactory = (apiKey) => new Resend(apiKey),
) {
  const provider = required(environment, "EMAIL_PROVIDER");
  const expectedProvider = productionRuntime ? "resend" : "mailpit";
  if (provider !== expectedProvider) {
    throw new Error(`EMAIL_PROVIDER must be ${expectedProvider} for this runtime`);
  }

  const from = required(environment, "EMAIL_FROM");
  let send: (message: Message) => Promise<unknown>;
  if (productionRuntime) {
    const resend = createResend(required(environment, "RESEND_API_KEY"));
    send = async ({ to, subject, text }) => {
      const { error } = await resend.emails.send({ from, to, subject, text });
      if (error) throw error;
    };
  } else {
    const port = Number(required(environment, "SMTP_PORT"));
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error("SMTP_PORT must be a valid TCP port");
    }
    const mailer = nodemailer.createTransport({
      host: required(environment, "SMTP_HOST"),
      port,
      secure: port === 465,
    });
    send = ({ to, subject, text }) => mailer.sendMail({ from, to, subject, text });
  }

  return async (message: Message): Promise<void> => {
    try {
      await send(message);
    } catch {
      throw new Error("Email delivery failed");
    }
  };
}
