import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const projectRoot = resolve(import.meta.dirname, "../..");
const backupScript = join(projectRoot, "scripts/db-backup.sh");
const restoreScript = join(projectRoot, "scripts/db-restore.sh");
const temporaryDirectories: string[] = [];

function run(script: string, args: string[] = []) {
  return spawnSync("bash", [script, ...args], {
    cwd: projectRoot,
    encoding: "utf8",
  });
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("database operation command guards", () => {
  it("documents the backup command without requiring Docker", () => {
    const result = run(backupScript, ["--help"]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("pnpm db:backup");
  });

  it("requires a backup path and explicit restore confirmation", () => {
    const result = run(restoreScript);

    expect(result.status).toBe(64);
    expect(result.stderr).toContain("--confirm portfolio_manager");
  });

  it("rejects a confirmation for any other database before calling Docker", () => {
    const directory = mkdtempSync(join(tmpdir(), "portfolio-restore-test-"));
    temporaryDirectories.push(directory);
    const backup = join(directory, "backup.dump");
    writeFileSync(backup, "not-a-real-backup");

    const result = run(restoreScript, [backup, "--confirm", "another_database"]);

    expect(result.status).toBe(64);
    expect(result.stderr).toContain("must exactly match 'portfolio_manager'");
  });

  it("rejects a missing backup before calling Docker", () => {
    const result = run(restoreScript, ["missing.dump", "--confirm", "portfolio_manager"]);

    expect(result.status).toBe(66);
    expect(result.stderr).toContain("does not exist or is empty");
  });
});
