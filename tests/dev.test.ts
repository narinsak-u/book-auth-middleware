import { expect, test } from "bun:test";
import { hostDevelopmentEnvironment } from "../scripts/dev";

test("maps Compose-only dependency hosts to loopback for Bun development", () => {
  const environment = hostDevelopmentEnvironment({
    DATABASE_URL: "postgres://central:local@db:5432/central",
    SMTP_HOST: "mailpit",
    SMTP_PORT: "1025",
    BETTER_AUTH_URL: "http://localhost:8080",
    PORT: "3000",
  });

  expect(new URL(environment.DATABASE_URL!).hostname).toBe("127.0.0.1");
  expect(environment.SMTP_HOST).toBe("127.0.0.1");
  expect(environment.HOST).toBe("127.0.0.1");
  expect(environment.PORT).toBe("3080");
  expect(environment.BETTER_AUTH_URL).toBe("http://localhost:8080");
  expect(environment.LOCAL_DEVELOPMENT).toBe("true");
});

test("preserves explicit development dependency hosts", () => {
  const environment = hostDevelopmentEnvironment({
    DATABASE_URL: "postgres://central:local@localhost:5432/central",
    SMTP_HOST: "smtp.example.test",
  });

  expect(new URL(environment.DATABASE_URL!).hostname).toBe("localhost");
  expect(environment.SMTP_HOST).toBe("smtp.example.test");
});

test("requires a development database URL", () => {
  expect(() => hostDevelopmentEnvironment({})).toThrow("DATABASE_URL is required for Bun development");
});
