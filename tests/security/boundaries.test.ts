import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { publicErrorMessage } from "@/lib/public-error";

const sourceRoot = path.join(process.cwd(), "src");
const featureRoot = path.join(sourceRoot, "features");

describe("server and client security boundaries", () => {
  it("keeps direct database clients out of feature orchestration", () => {
    const offenders = sourceFiles(featureRoot).flatMap((file) => (
      persistenceBoundaryViolations(file, readFileSync(file, "utf8"))
    ));
    expect(offenders).toEqual([]);
  });

  it("allows Prisma in repositories but rejects client access from orchestration modules", () => {
    expect(persistenceBoundaryViolations(
      path.join(featureRoot, "portfolio", "repository.ts"),
      'import type { PrismaClient } from "@prisma/client";\nimport { prisma } from "@/lib/db/client";',
    )).toEqual([]);
    expect(persistenceBoundaryViolations(
      path.join(featureRoot, "portfolio", "mutations.ts"),
      'import type { PrismaClient } from "@prisma/client";\nimport { prisma } from "@/lib/db/client";\ndb.asset.findUnique({ where: { id } });',
    )).toEqual([
      "src/features/portfolio/mutations.ts:1",
      "src/features/portfolio/mutations.ts:2",
      "src/features/portfolio/mutations.ts:3",
    ]);
  });

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

  it("only exports async functions from use server modules", () => {
    const offenders = sourceFiles(sourceRoot).flatMap((file) => {
      const content = readFileSync(file, "utf8");
      const sourceFile = ts.createSourceFile(file, content, ts.ScriptTarget.Latest, true);
      const firstStatement = sourceFile.statements[0];
      const isUseServerModule = Boolean(
        firstStatement
        && ts.isExpressionStatement(firstStatement)
        && ts.isStringLiteral(firstStatement.expression)
        && firstStatement.expression.text === "use server",
      );
      if (!isUseServerModule) return [];

      return sourceFile.statements.flatMap((statement) => {
        if (!hasModifier(statement, ts.SyntaxKind.ExportKeyword)) return [];
        if (ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement)) return [];
        if (ts.isExportDeclaration(statement) && statement.isTypeOnly) return [];
        if (ts.isFunctionDeclaration(statement) && hasModifier(statement, ts.SyntaxKind.AsyncKeyword)) return [];

        const line = sourceFile.getLineAndCharacterOfPosition(statement.getStart(sourceFile)).line + 1;
        return [`${path.relative(process.cwd(), file)}:${line}`];
      });
    });

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

function hasModifier(node: ts.Node, modifier: ts.SyntaxKind) {
  return ts.canHaveModifiers(node) && Boolean(ts.getModifiers(node)?.some((item) => item.kind === modifier));
}

function persistenceBoundaryViolations(file: string, content: string) {
  if (file.endsWith(`${path.sep}repository.ts`)) return [];
  const relativeFile = path.relative(process.cwd(), file);
  const sourceFile = ts.createSourceFile(file, content, ts.ScriptTarget.Latest, true);

  const importViolations = sourceFile.statements.flatMap((statement) => {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) return [];
    const moduleName = statement.moduleSpecifier.text;
    const importsDbClient = moduleName === "@/lib/db/client";
    const importsPrismaClient = moduleName === "@prisma/client"
      && statement.importClause?.namedBindings
      && ts.isNamedImports(statement.importClause.namedBindings)
      && statement.importClause.namedBindings.elements.some((element) => element.name.text === "PrismaClient");
    if (!importsDbClient && !importsPrismaClient) return [];

    const line = sourceFile.getLineAndCharacterOfPosition(statement.getStart(sourceFile)).line + 1;
    return [`${relativeFile}:${line}`];
  });
  const queryViolations: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const operation = node.expression.name.text;
      const modelAccess = node.expression.expression;
      if (
        /^(?:find|create|update|delete|upsert|count|aggregate|groupBy)/.test(operation)
        && ts.isPropertyAccessExpression(modelAccess)
        && ts.isIdentifier(modelAccess.expression)
        && ["prisma", "db", "transaction"].includes(modelAccess.expression.text)
      ) {
        const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
        queryViolations.push(`${relativeFile}:${line}`);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);

  const transactionClientViolations = content.split("\n").flatMap((line, index) => (
    /\bPrisma\s*\.\s*TransactionClient\b/.test(line) ? [`${relativeFile}:${index + 1}`] : []
  ));
  return [...new Set([...importViolations, ...transactionClientViolations, ...queryViolations])];
}
