import { afterAll, expect, test } from "bun:test";
import { copyFileSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = new URL("../", import.meta.url).pathname;
const worktree = mkdtempSync("/tmp/central-env-hook-");
afterAll(() => rmSync(worktree, { recursive: true, force: true }));

function run(...cmd: string[]) {
  const result = Bun.spawnSync({
    cmd, cwd: worktree, stdout: "pipe", stderr: "pipe",
    env: { ...process.env, PATH: `${root}/node_modules/.bin:${process.env.PATH}` },
  });
  return { code: result.exitCode, stderr: result.stderr.toString(), stdout: result.stdout.toString() };
}

test("commit encrypts staged config but refuses staged private keys or partial edits", () => {
  mkdirSync(join(worktree, ".husky"));
  copyFileSync(join(root, ".husky/pre-commit"), join(worktree, ".husky/pre-commit"));
  copyFileSync(join(root, "package.json"), join(worktree, "package.json"));
  mkdirSync(join(worktree, "scripts"));
  copyFileSync(join(root, "scripts/pre-commit-env.sh"), join(worktree, "scripts/pre-commit-env.sh"));
  copyFileSync(join(root, "scripts/env-all.sh"), join(worktree, "scripts/env-all.sh"));
  symlinkSync(join(root, "node_modules"), join(worktree, "node_modules"), "dir");
  expect(run("git", "init", "-q").code).toBe(0);
  writeFileSync(join(worktree, ".env.development"), "HELLO=secret-smoke-value\nCOMPOSE_PROJECT_NAME=\"book-auth-middleware\"\n");
  expect(run("bun", "run", "dev:ec").code).toBe(0);
  expect(run("bun", "run", "dev:dc").code).toBe(0);
  expect(run("git", "add", ".env.development").code).toBe(0);
  expect(run("sh", ".husky/pre-commit").code).toBe(0);
  const staged = run("git", "show", ":.env.development").stdout;
  expect(staged).toContain("encrypted:");
  expect(staged).not.toContain("secret-smoke-value");

  writeFileSync(join(worktree, ".env.development"), `${readFileSync(join(worktree, ".env.development"), "utf8")}OTHER=unstaged\n`);
  expect(run("sh", ".husky/pre-commit").stderr).toContain("partially staged");
  writeFileSync(join(worktree, ".env.development"), staged);

  writeFileSync(join(worktree, ".env.test-production"), "VALUE=test-production-secret\n");
  expect(run("dotenvx", "encrypt", "-f", ".env.test-production", "-fk", ".env.test-production.keys").code).toBe(0);
  expect(run("git", "add", ".env.test-production").code).toBe(0);
  const testProductionHook = run("sh", ".husky/pre-commit");
  expect(testProductionHook.code, testProductionHook.stderr).toBe(0);
  const testProduction = run("git", "show", ":.env.test-production").stdout;
  expect(testProduction).toContain("encrypted:");
  expect(testProduction).not.toContain("test-production-secret");

  writeFileSync(join(worktree, ".env.production"), "VALUE=production-secret\n");
  expect(run("dotenvx", "encrypt", "-f", ".env.production", "-fk", ".env.keys").code).toBe(0);
  expect(run("git", "add", ".env.production").code).toBe(0);
  const productionHook = run("sh", ".husky/pre-commit");
  expect(productionHook.code, productionHook.stderr).toBe(0);
  expect(run("git", "show", ":.env.production").stdout).not.toContain("production-secret");
  expect(run("bun", "run", "all:dc").code).toBe(0);
  expect(readFileSync(join(worktree, ".env.development"), "utf8")).toContain("secret-smoke-value");
  expect(readFileSync(join(worktree, ".env.test-production"), "utf8")).toContain("test-production-secret");
  expect(readFileSync(join(worktree, ".env.production"), "utf8")).toContain("production-secret");
  expect(run("bun", "run", "all:ec").code).toBe(0);
  expect(readFileSync(join(worktree, ".env.development"), "utf8")).not.toContain("secret-smoke-value");
  expect(readFileSync(join(worktree, ".env.test-production"), "utf8")).not.toContain("test-production-secret");
  expect(readFileSync(join(worktree, ".env.production"), "utf8")).not.toContain("production-secret");
  expect(run("git", "add", ".env.development", ".env.production", ".env.test-production").code).toBe(0);

  expect(run("git", "add", "-f", ".env.test-production.keys").code).toBe(0);
  expect(run("sh", ".husky/pre-commit").stderr).toContain("Refusing to commit dotenvx private keys");
  expect(run("git", "reset", "--", ".env.test-production.keys").code).toBe(0);

  expect(run("git", "add", "-f", ".env.keys").code).toBe(0);
  expect(run("sh", ".husky/pre-commit").stderr).toContain("Refusing to commit dotenvx private keys");
}, 30_000);
