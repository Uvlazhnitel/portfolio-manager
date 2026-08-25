import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { publicErrorMessage } from "@/lib/public-error";

const sourceRoot = path.join(process.cwd(), "src");

describe("server and client security boundaries", () => {
  it("does not import Prisma runtime from client components", () => {
    const offenders = sourceFiles(sourceRoot).filter((file) => {
      const content = readFileSync(file, "utf8");
      return content.trimStart().startsWith('"use client"') && content.includes('from "@prisma/client"');
    });
    expect(offenders).toEqual([]);
  });

  it("does not expose secret keys through NEXT_PUBLIC variables", () => {
    const offenders = sourceFiles(sourceRoot).filter((file) =>
      /NEXT_PUBLIC_[A-Z0-9_]*(?:KEY|SECRET|TOKEN)/.test(readFileSync(file, "utf8")),
    );
    expect(offenders).toEqual([]);
  });

  it("keeps encryption and stored credential fields out of client components", () => {
    const offenders = sourceFiles(sourceRoot).filter((file) => {
      const content = readFileSync(file, "utf8");
      return content.trimStart().startsWith('"use client"') && (
        content.includes("encryptedApiKey")
        || content.includes("features/integrations/crypto")
        || content.includes("features/integrations/repository")
      );
    });
    expect(offenders).toEqual([]);
  });

  it("does not use raw HTML injection", () => {
    const offenders = sourceFiles(sourceRoot).filter((file) =>
      readFileSync(file, "utf8").includes("dangerouslySetInnerHTML"),
    );
    expect(offenders).toEqual([]);
  });

  it("returns validation details but hides unexpected internal errors", () => {
    const schema = z.object({ amount: z.string().min(1, "Amount is required.") });
    const validationError = schema.safeParse({ amount: "" });
    expect(validationError.success).toBe(false);
    if (!validationError.success) {
      expect(publicErrorMessage(validationError.error, "Fallback")).toBe("Amount is required.");
    }
    expect(publicErrorMessage(new Error("password=secret database host failed"), "Safe fallback")).toBe("Safe fallback");
  });
});

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const file = path.join(directory, entry);
    return statSync(file).isDirectory()
      ? sourceFiles(file)
      : /\.(?:ts|tsx)$/.test(file) ? [file] : [];
  });
}
