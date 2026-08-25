import { z } from "zod";
import { AssetClass } from "@/lib/domain/enums";

const moneySchema = z.union([z.string(), z.number()]).transform((value, context) => {
  const normalized = String(value).trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) {
    context.addIssue({ code: "custom", message: "Use a non-negative amount with at most two decimal places." });
    return z.NEVER;
  }
  return normalized;
});

export const contributionAllocationSchema = z.object({
  assetClass: z.enum(AssetClass),
  amount: moneySchema,
});

export const contributionPreviewInputSchema = z.object({
  contributionAmount: moneySchema,
  allocations: z.array(contributionAllocationSchema).optional(),
});

export const saveContributionPlanInputSchema = contributionPreviewInputSchema.extend({
  strategyId: z.string().min(1),
  currency: z.string().trim().length(3),
  isCustomized: z.boolean(),
  allocations: z.array(contributionAllocationSchema),
});

export type ContributionPreviewInput = z.input<typeof contributionPreviewInputSchema>;
export type SaveContributionPlanInput = z.input<typeof saveContributionPlanInputSchema>;
export type ParsedContributionAllocation = z.output<typeof contributionAllocationSchema>;

export function validateContributionAllocations(
  contributionAmount: string,
  allocations: ParsedContributionAllocation[],
  activeAssetClasses: AssetClass[],
) {
  const counts = new Map<AssetClass, number>();
  const activeClassSet = new Set(activeAssetClasses);
  let totalCents = 0;

  for (const allocation of allocations) {
    if (!activeClassSet.has(allocation.assetClass)) {
      throw new Error(`${allocation.assetClass} is not enabled in the active strategy.`);
    }
    counts.set(allocation.assetClass, (counts.get(allocation.assetClass) ?? 0) + 1);
    totalCents += moneyToCents(allocation.amount);
  }

  for (const assetClass of activeAssetClasses) {
    if (counts.get(assetClass) !== 1) {
      throw new Error(`Contribution must contain one ${assetClass} allocation.`);
    }
  }
  for (const [assetClass, count] of counts) {
    if (count > 1) {
      throw new Error(`Contribution must contain only one ${assetClass} allocation.`);
    }
  }
  if (totalCents !== moneyToCents(contributionAmount)) {
    throw new Error("Custom allocation must equal the contribution amount exactly.");
  }

  return allocations;
}

export function moneyToCents(value: string) {
  const [whole, fraction = ""] = value.split(".");
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(cents)) {
    throw new Error("Contribution amount is too large.");
  }
  return cents;
}

export function parsePreviewInput(input: ContributionPreviewInput) {
  return contributionPreviewInputSchema.parse(input);
}

export function parseContributionQueryAmount(value: string | string[] | undefined) {
  if (typeof value !== "string") return null;
  const parsed = contributionPreviewInputSchema.safeParse({ contributionAmount: value });
  return parsed.success && moneyToCents(parsed.data.contributionAmount) > 0
    ? parsed.data.contributionAmount
    : null;
}

export function parseSaveInput(input: SaveContributionPlanInput) {
  const parsed = saveContributionPlanInputSchema.parse(input);
  if (moneyToCents(parsed.contributionAmount) <= 0) {
    throw new Error("Contribution amount must be greater than zero.");
  }
  return parsed;
}
