import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("custodian migration compatibility", () => {
  it("adds a nullable relation without rewriting legacy accounts", () => {
    const sql = readFileSync("prisma/migrations/20260829190000_add_custodians_and_risk_limits/migration.sql", "utf8");
    expect(sql).toContain('ALTER TABLE "Account" ADD COLUMN "custodianId" TEXT;');
    expect(sql).toContain("ON DELETE SET NULL");
    expect(sql).not.toMatch(/UPDATE\s+"Account"/i);
    expect(sql).not.toMatch(/"custodianId"\s+TEXT\s+NOT NULL/i);
  });
});
