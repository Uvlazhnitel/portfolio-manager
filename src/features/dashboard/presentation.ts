import type { AssetClass } from "@prisma/client";
import { contributionClassLabels } from "@/features/contributions/presentation";
import type { ContributionProjection } from "@/features/portfolio-engine";
import { decimalSign, formatDecimalCurrency, formatDecimalPercent } from "@/lib/format/decimal";

export type DashboardContributionItem = {
  key: string;
  symbol: string;
  name: string;
  assetClass: AssetClass;
  amount: string;
  percentOfContribution: string;
};

export function formatDashboardCurrency(value: string, currency: string) {
  return formatDecimalCurrency(value, currency);
}

export function formatDashboardSignedCurrency(value: string, currency: string) {
  const sign = decimalSign(value);
  if (sign === null) return "—";
  const formatted = formatDashboardCurrency(value.replace(/^-/, ""), currency);
  return `${sign >= 0 ? "+" : "−"}${formatted}`;
}

export function formatDashboardPercent(value: string) {
  return formatDecimalPercent(value, 1);
}

export function strategyWarningText(warning: {
  code: string;
  assetClass: AssetClass;
  currentPercent: string;
  limitPercent: string;
}) {
  return `${contributionClassLabels[warning.assetClass]} is ${formatDashboardPercent(warning.currentPercent)}, ${warning.code.endsWith("ABOVE_MAX") ? "above the configured maximum" : "below the configured minimum"} of ${formatDashboardPercent(warning.limitPercent)}.`;
}

export function dashboardContributionItems(projection: ContributionProjection): DashboardContributionItem[] {
  const recommendationsByClass = new Map<AssetClass, ContributionProjection["plan"]["assetRecommendations"]>();
  for (const recommendation of projection.plan.assetRecommendations) {
    const recommendations = recommendationsByClass.get(recommendation.assetClass) ?? [];
    recommendations.push(recommendation);
    recommendationsByClass.set(recommendation.assetClass, recommendations);
  }

  return projection.plan.allocations.flatMap((allocation) => {
    if (Number(allocation.amount) <= 0) return [];

    const recommendations = recommendationsByClass.get(allocation.assetClass) ?? [];
    if (recommendations.length > 0) {
      return recommendations.map((recommendation) => ({
        key: `asset-${recommendation.assetId}`,
        symbol: recommendation.symbol,
        name: recommendation.name,
        assetClass: recommendation.assetClass,
        amount: recommendation.amount,
        percentOfContribution: recommendation.percentOfContribution,
      }));
    }

    return [{
      key: `class-${allocation.assetClass}`,
      symbol: contributionClassLabels[allocation.assetClass],
      name: "Choose an asset",
      assetClass: allocation.assetClass,
      amount: allocation.amount,
      percentOfContribution: allocation.percentOfContribution,
    }];
  });
}
