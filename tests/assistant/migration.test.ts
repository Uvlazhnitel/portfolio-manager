import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("assistant message lifecycle migration", () => {
  it("backfills unmatched user messages as failed without deleting conversation history", () => {
    const sql = readFileSync("prisma/migrations/20260831100000_add_assistant_message_lifecycle/migration.sql", "utf8");
    expect(sql).toContain("CREATE TYPE \"AssistantMessageStatus\"");
    expect(sql).toContain("LEAD(\"role\"::text)");
    expect(sql).toContain("ordered.\"nextRole\" IS DISTINCT FROM 'ASSISTANT'");
    expect(sql).toContain("SET \"status\" = 'FAILED'");
    expect(sql).not.toMatch(/DELETE\s+FROM\s+"AssistantMessage"/i);
  });
});
