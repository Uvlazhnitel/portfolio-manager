import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("assistant conversation controls", () => {
  const source = readFileSync("src/app/assistant/_components/assistant-client.tsx", "utf8");

  it("opens an explicit blank chat and exposes delete and retry controls", () => {
    expect(source).toContain('router.push("/assistant?new=1")');
    expect(source).toContain('method: "DELETE"');
    expect(source).toContain("Delete current conversation");
    expect(source).toContain(">Retry</button>");
  });
});
