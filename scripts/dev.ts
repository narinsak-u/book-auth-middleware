type Environment = Record<string, string | undefined>;

export function hostDevelopmentEnvironment(environment: Environment): Environment {
  const databaseUrl = environment.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required for Bun development");

  const database = new URL(databaseUrl);
  if (database.hostname === "db") database.hostname = "127.0.0.1";

  return {
    ...environment,
    DATABASE_URL: database.toString(),
    SMTP_HOST: environment.SMTP_HOST === "mailpit" ? "127.0.0.1" : environment.SMTP_HOST,
    NODE_ENV: "development",
    PORT: "3080",
    HOST: "127.0.0.1",
  };
}

async function runDevelopment(): Promise<void> {
  const root = new URL("../", import.meta.url).pathname;
  const environment = hostDevelopmentEnvironment(process.env);
  const migration = Bun.spawn(["bun", "run", "db:migrate"], {
    cwd: root,
    env: environment,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  const migrationExit = await migration.exited;
  if (migrationExit !== 0) process.exit(migrationExit);

  const children = [
    Bun.spawn(["bun", "run", "dev"], {
      cwd: `${root}apps/server`,
      env: environment,
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    }),
    Bun.spawn(["bun", "run", "dev"], {
      cwd: `${root}apps/web`,
      env: environment,
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    }),
  ];

  const stop = () => {
    for (const child of children) {
      if (child.exitCode === null) child.kill("SIGTERM");
    }
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);

  const exitCode = await Promise.race(children.map((child) => child.exited));
  stop();
  await Promise.all(children.map((child) => child.exited));
  process.off("SIGINT", stop);
  process.off("SIGTERM", stop);
  process.exitCode = exitCode;
}

if (import.meta.main) await runDevelopment();
