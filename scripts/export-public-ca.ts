import { readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export function exportPublicCa(source: string, destination: string): boolean {
  const contents = readFileSync(source);
  try {
    if (readFileSync(destination).equals(contents)) return false;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  const temporary = join(dirname(destination), `.central-identity-root.${process.pid}.tmp`);
  try {
    writeFileSync(temporary, contents, { mode: 0o644 });
    renameSync(temporary, destination);
  } finally {
    rmSync(temporary, { force: true });
  }
  return true;
}

if (import.meta.main) {
  const [source, destination] = Bun.argv.slice(2);
  if (!source || !destination) throw new Error("Usage: bun scripts/export-public-ca.ts SOURCE DESTINATION");
  exportPublicCa(source, destination);
}
