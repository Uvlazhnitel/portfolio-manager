import type { AssetClass } from "@prisma/client";
import type { ContributionReason } from "@/features/portfolio-engine";

export const contributionClassLabels: Record<AssetClass, string> = {
  ETF: "ETF",
  CRYPTO: "Crypto",
  GOLD: "Gold",
  CASH: "Cash",
  OTHER: "Other",
};

export function contributionReasonText(reason: ContributionReason) {
  const label = reason.assetClass ? contributionClassLabels[reason.assetClass] : "This asset class";
  if (reason.code === "ASSET_CLASS_UNDERWEIGHT") return `${label} is currently below your target allocation.`;
  if (reason.code === "OVERWEIGHT_CLASS_RECEIVES_NO_CONTRIBUTION") return `${label} is above its preferred range, so this contribution adds no additional exposure.`;
  if (reason.code === "CUSTOM_ALLOCATION_ABOVE_MAX") return `Your custom allocation would leave ${label.toLowerCase()} outside its configured range.`;
  if (reason.code === "CONTRIBUTION_MOVES_TOWARD_TARGET") return "The contribution moves the portfolio toward its configured target.";
  if (reason.code === "NO_SELL_REQUIRED") return "Your allocation can move toward the target without selling existing assets.";
  if (reason.code === "NO_CONTRIBUTION") return "Enter a positive contribution amount to calculate a plan.";
  return `${label}: ${reason.code.toLowerCase().replaceAll("_", " ")}.`;
}
