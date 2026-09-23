import "server-only";

import { createHash } from "node:crypto";
import { AssetType, TransactionType } from "@prisma/client";
import { decimal, ZERO } from "@/features/portfolio-engine/decimal";
import {
  PERSONAL_CFO_FINGERPRINT_VERSION,
  type PersonalCfoIdentity,
} from "@/features/personal-cfo-integration/contract";
import { PersonalCfoRequestError } from "@/features/personal-cfo-integration/http";
import {
  PersonalCfoIntegrationRepository,
  type CapitalFlowCursorPosition,
  type CapitalFlowRevisionRow,
} from "@/features/personal-cfo-integration/repository";

const DEFAULT_PAGE_SIZE = 100;
const MAX_PAGE_SIZE = 500;

type CapitalFlowRepository = Pick<
  PersonalCfoIntegrationRepository,
  "listCapitalFlowPage" | "listTransactionLineage"
>;

export async function buildPersonalCfoCapitalFlows({
  identity,
  cursor,
  limit,
  repository = new PersonalCfoIntegrationRepository(),
}: {
  identity: PersonalCfoIdentity;
  cursor: string | null;
  limit: string | null;
  repository?: CapitalFlowRepository;
}) {
  const after = decodeCapitalFlowCursor(cursor);
  const pageSize = parseCapitalFlowLimit(limit);
  const [rows, lineage] = await Promise.all([
    repository.listCapitalFlowPage({ after, take: pageSize + 1 }),
    repository.listTransactionLineage(),
  ]);
  const hasMore = rows.length > pageSize;
  const pageRows = rows.slice(0, pageSize);
  const parentByRevisionId = new Map(lineage.map((row) => [row.id, row.replacesTransactionId]));
  const items = pageRows.map((row) => serializeCapitalFlowRevision(row, parentByRevisionId));
  const last = pageRows.at(-1);

  return {
    ...identity,
    items,
    hasMore,
    nextCursor: last
      ? encodeCapitalFlowCursor({ changedAt: last.updatedAt, revisionId: last.id })
      : cursor,
  };
}

export function parseCapitalFlowLimit(value: string | null) {
  if (value === null) return DEFAULT_PAGE_SIZE;
  if (!/^[1-9]\d*$/.test(value)) {
    throw new PersonalCfoRequestError(400, "INVALID_LIMIT", "limit must be a positive integer.");
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed > MAX_PAGE_SIZE) {
    throw new PersonalCfoRequestError(400, "INVALID_LIMIT", `limit must be between 1 and ${MAX_PAGE_SIZE}.`);
  }
  return parsed;
}

export function encodeCapitalFlowCursor(position: CapitalFlowCursorPosition) {
  return Buffer.from(JSON.stringify({
    v: 1,
    changedAt: position.changedAt.toISOString(),
    revisionId: position.revisionId,
  }), "utf8").toString("base64url");
}

export function decodeCapitalFlowCursor(value: string | null): CapitalFlowCursorPosition | null {
  if (value === null) return null;
  try {
    if (value.length > 2_048) throw new Error("Cursor is too long.");
    const parsed: unknown = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    if (!isCursorPayload(parsed)) throw new Error("Invalid cursor payload.");
    const changedAt = new Date(parsed.changedAt);
    if (!Number.isFinite(changedAt.getTime()) || changedAt.toISOString() !== parsed.changedAt) {
      throw new Error("Invalid cursor timestamp.");
    }
    return { changedAt, revisionId: parsed.revisionId };
  } catch {
    throw new PersonalCfoRequestError(400, "INVALID_CURSOR", "cursor is invalid.");
  }
}

export function serializeCapitalFlowRevision(
  row: CapitalFlowRevisionRow,
  parentByRevisionId: Map<string, string | null>,
) {
  const eventId = rootRevisionId(row.id, parentByRevisionId);
  const direction = row.type === TransactionType.DEPOSIT ? "contribution" as const : "withdrawal" as const;
  const amountResult = originalCurrencyAmount(row);
  const replacementRevisionIds = row.replacementTransactions.map((replacement) => replacement.id).sort();
  const canonical = {
    eventId,
    revisionId: row.id,
    sourceTransactionId: row.id,
    status: row.status,
    direction,
    accountId: row.accountId,
    assetId: row.assetId,
    amount: amountResult.amount,
    amountUnavailableReason: amountResult.unavailableReason,
    currency: row.currency,
    effectiveAt: row.executedAt.toISOString(),
    changedAt: row.updatedAt.toISOString(),
    replacesRevisionId: row.replacesTransactionId,
    replacementRevisionIds,
  };
  const fingerprintInput = JSON.stringify([
    PERSONAL_CFO_FINGERPRINT_VERSION,
    canonical.eventId,
    canonical.revisionId,
    canonical.status,
    canonical.direction,
    canonical.amount,
    canonical.amountUnavailableReason,
    canonical.currency,
    canonical.accountId,
    canonical.assetId,
    canonical.effectiveAt,
    canonical.changedAt,
    canonical.replacesRevisionId,
    canonical.replacementRevisionIds,
  ]);
  return {
    ...canonical,
    revisionFingerprint: `sha256:${createHash("sha256").update(fingerprintInput, "utf8").digest("hex")}`,
  };
}

function originalCurrencyAmount(row: CapitalFlowRevisionRow) {
  const price = row.pricePerUnit === null
    ? row.asset.assetType === AssetType.FIAT && row.asset.currency.toUpperCase() === row.currency.toUpperCase()
      ? decimal(1)
      : null
    : decimal(row.pricePerUnit);
  const amount = price ? decimal(row.quantity).mul(price) : null;
  if (!amount || !amount.greaterThan(ZERO)) {
    return {
      amount: null,
      unavailableReason: "MISSING_OR_NON_POSITIVE_ORIGINAL_AMOUNT" as const,
    };
  }
  return { amount: amount.toString(), unavailableReason: null };
}

function rootRevisionId(revisionId: string, parentByRevisionId: Map<string, string | null>) {
  const visited = new Set<string>();
  let current = revisionId;
  while (true) {
    if (visited.has(current)) throw new Error("Transaction replacement chain contains a cycle.");
    visited.add(current);
    const parent = parentByRevisionId.get(current);
    if (!parent) return current;
    if (!parentByRevisionId.has(parent)) return parent;
    current = parent;
  }
}

function isCursorPayload(value: unknown): value is { v: 1; changedAt: string; revisionId: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return Object.keys(record).sort().join(",") === "changedAt,revisionId,v"
    && record.v === 1
    && typeof record.changedAt === "string"
    && typeof record.revisionId === "string"
    && record.revisionId.length > 0
    && record.revisionId.length <= 256;
}

export type PersonalCfoCapitalFlows = Awaited<ReturnType<typeof buildPersonalCfoCapitalFlows>>;
