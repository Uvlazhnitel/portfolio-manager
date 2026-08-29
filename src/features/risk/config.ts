import { PortfolioRuleType } from "@prisma/client";

export function riskThresholdsFromRules(rules: Array<{ type: PortfolioRuleType; enabled: boolean; config: unknown }>) {
  const byType = new Map(rules.map((rule) => [rule.type, rule]));
  return {
    singleAssetMaxPercent: enabledLimit(byType.get(PortfolioRuleType.SINGLE_ASSET_MAX_ALLOCATION)),
    custodianMaxPercent: enabledLimit(byType.get(PortfolioRuleType.CUSTODIAN_MAX_ALLOCATION)),
  };
}

function enabledLimit(rule: { enabled: boolean; config: unknown } | undefined) {
  if (!rule?.enabled || !rule.config || typeof rule.config !== "object" || Array.isArray(rule.config)) return null;
  const value = (rule.config as Record<string, unknown>).maxPercent;
  return typeof value === "string" || typeof value === "number" ? String(value) : null;
}
