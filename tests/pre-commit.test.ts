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
  symlinkSync(join(root, "node_modules"), join(worktree, "node_modules"), "dir");
  expect(run("git", "init", "-q").code).toBe(0);
  writeFileSync(join(worktree, ".env.development"), "HELLO=secret-smoke-value\nCOMPOSE_PROJECT_NAME=\"book-auth-middleware\"\n");
  expect(run("bun", "run", "env:encrypt", "--", "-f", ".env.development").code).toBe(0);
  expect(run("bun", "run", "env:decrypt", "--", "-f", ".env.development").code).toBe(0);
  expect(run("git", "add", ".env.development").code).toBe(0);
  expect(run("sh", ".husky/pre-commit").code).toBe(0);
  const staged = run("git", "show", ":.env.development").stdout;
  expect(staged).toContain("encrypted:");
  expect(staged).not.toContain("secret-smoke-value");

  writeFileSync(join(worktree, ".env.development"), `${readFileSync(join(worktree, ".env.development"), "utf8")}OTHER=unstaged\n`);
  expect(run("sh", ".husky/pre-commit").stderr).toContain("partially staged");
  writeFileSync(join(worktree, ".env.development"), staged);

  expect(run("git", "add", "-f", ".env.keys").code).toBe(0);
  expect(run("sh", ".husky/pre-commit").stderr).toContain("Refusing to commit dotenvx private keys");
});
