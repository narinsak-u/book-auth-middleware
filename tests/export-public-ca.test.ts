import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { exportPublicCa } from "../scripts/export-public-ca";

test("public CA export is atomic in effect and leaves an unchanged file untouched", () => {
  const directory = mkdtempSync(join(tmpdir(), "central-ca-export-"));
  const source = join(directory, "source.crt");
  const destination = join(directory, "central-identity-root.crt");
  try {
    writeFileSync(source, "public root one");
    expect(exportPublicCa(source, destination)).toBe(true);
    const unchanged = statSync(destination);
    expect(readFileSync(destination, "utf8")).toBe("public root one");
    expect(exportPublicCa(source, destination)).toBe(false);
    expect(statSync(destination).mtimeMs).toBe(unchanged.mtimeMs);

    writeFileSync(source, "public root two");
    expect(exportPublicCa(source, destination)).toBe(true);
    expect(readFileSync(destination, "utf8")).toBe("public root two");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
