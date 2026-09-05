import { decimal, ONE_HUNDRED, toDecimalString, ZERO } from "@/features/portfolio-engine/decimal";
import { evaluateStrategyCompliance, getPortfolioValuationAvailability } from "@/features/portfolio-engine/engine";
import type { CalculatePortfolioRiskInput, EngineCustodianCategory, PortfolioRiskSnapshot, RiskExposure, RiskMetric, RiskReasonCode, RiskViolation } from "@/features/portfolio-engine/types";

export function calculatePortfolioRisk(input: CalculatePortfolioRiskInput): PortfolioRiskSnapshot {
  const valuation = getPortfolioValuationAvailability(input.portfolio);
  const missing = valuation.missingPriceSymbols;
  const total = decimal(input.portfolio.totalValue);
  const noValue = total.lessThanOrEqualTo(ZERO);
  const incomplete = valuation.state === "PARTIAL";
  const baseState = noValue ? "UNAVAILABLE" as const : incomplete ? "PARTIAL" as const : "OK" as const;
  const baseReasons: RiskReasonCode[] = noValue ? ["NO_VALUED_HOLDINGS"] : incomplete ? ["INCOMPLETE_VALUATION", "MISSING_MARKET_PRICE"] : [];
  if (input.hasStalePrices) baseReasons.push("STALE_PRICE_DATA");
  const accountById = new Map(input.accounts.map((account) => [account.id, account]));
  const assetById = new Map(input.assets.map((asset) => [asset.id, asset]));
  const assetValues = sumBy(input.portfolio.valuedHoldings.map((holding) => [holding.assetId, holding.value]));
  const accountValues = sumBy(input.portfolio.valuedHoldings.map((holding) => [holding.accountId, holding.value]));
  const accountTypeValues = sumBy([...accountValues].map(([id, value]) => [accountById.get(id)?.type ?? "OTHER", value.toString()]));
  const custodyValues = sumBy([...accountValues].map(([id, value]) => [custodyCategory(accountById.get(id)), value.toString()]));
  const custodianValues = sumBy([...accountValues].filter(([id]) => accountById.get(id)?.custodian).map(([id, value]) => [accountById.get(id)!.custodian!.id, value.toString()]));
  const unassigned = [...accountValues].filter(([id, value]) => value.greaterThan(ZERO) && !accountById.get(id)?.custodian).map(([id]) => id).sort();

  const largestAssetEntry = sorted(assetValues)[0];
  const largestAccountEntry = sorted(accountValues)[0];
  const largestCustodianEntry = sorted(custodianValues)[0];
  const topThree = sorted(assetValues).slice(0, 3).reduce((sum, [, value]) => sum.plus(value), ZERO);
  const largestAsset = concentrationMetric(largestAssetEntry, total, baseState, baseReasons, input.thresholds.singleAssetMaxPercent, "SINGLE_ASSET_LIMIT_EXCEEDED", largestAssetEntry ? assetById.get(largestAssetEntry[0])?.symbol ?? largestAssetEntry[0] : null);
  const largestAccount = concentrationMetric(largestAccountEntry, total, baseState, baseReasons, null, null, largestAccountEntry ? accountById.get(largestAccountEntry[0])?.name ?? largestAccountEntry[0] : null);
  const custodianPartial = baseState === "OK" && unassigned.length > 0;
  const largestCustodian = custodianPartial
    ? unavailableMetric("PARTIAL", ["UNASSIGNED_CUSTODIAN"])
    : concentrationMetric(largestCustodianEntry, total, baseState, baseReasons, input.thresholds.custodianMaxPercent, "CUSTODIAN_LIMIT_EXCEEDED", largestCustodianEntry ? input.accounts.find((account) => account.custodian?.id === largestCustodianEntry[0])?.custodian?.name ?? largestCustodianEntry[0] : null);
  const cryptoValue = input.portfolio.allocation.find((item) => item.assetClass === "CRYPTO")?.value ?? "0";
  const cryptoAllocation = concentrationMetric(["CRYPTO", decimal(cryptoValue)], total, baseState, baseReasons, null, null, "Crypto");
  const staleReasons = input.hasStalePrices ? ["STALE_PRICE_DATA" as const] : [];
  const topThreeAssets = baseState === "OK" ? metricFromPercent(topThree.div(total).mul(ONE_HUNDRED), "OK", null, "Top 3 assets", null, staleReasons) : unavailableMetric(baseState, baseReasons);
  const violations = [largestAsset, largestCustodian].flatMap((metric, index): RiskViolation[] => {
    if (metric.state !== "WARNING" || !metric.valuePercent || !metric.limitPercent) return [];
    const code = metric.reasonCodes.find((reason) => reason.endsWith("LIMIT_EXCEEDED"));
    if (!code) return [];
    if (!metric.subjectId || !metric.subjectName) return [];
    return [{
      code,
      metric: ["largestAsset", "largestCustodian"][index],
      subjectId: metric.subjectId,
      subjectName: metric.subjectName,
      currentPercent: metric.valuePercent,
      limitPercent: metric.limitPercent,
      excessPercent: toDecimalString(decimal(metric.valuePercent).minus(metric.limitPercent)),
    }];
  });
  const strategyViolations = input.strategy && baseState === "OK" ? evaluateStrategyCompliance(input.portfolio, input.strategy) : [];
  const exposures = (values: Map<string, ReturnType<typeof decimal>>): RiskExposure[] => [...values].sort(([a], [b]) => a.localeCompare(b)).map(([category, value]) => baseState === "OK" ? { category, valuePercent: toDecimalString(value.div(total).mul(ONE_HUNDRED)), state: "OK", reasonCodes: input.hasStalePrices ? ["STALE_PRICE_DATA"] : [] } : { category, valuePercent: null, state: baseState, reasonCodes: [...baseReasons] });
  const custodyExposure = exposures(custodyValues);

  return {
    state: baseState !== "OK" ? baseState : unassigned.length > 0 ? "PARTIAL" : violations.length > 0 || strategyViolations.length > 0 ? "WARNING" : "OK",
    isStale: input.hasStalePrices,
    missingPriceSymbols: missing,
    unassignedCustodianAccountIds: unassigned,
    largestAsset, topThreeAssets, largestAccount, largestCustodian, cryptoAllocation,
    accountTypeExposure: exposures(accountTypeValues), custodyCategoryExposure: custodyExposure,
    exchangeExposure: exposureMetric(custodyExposure, "EXCHANGE", baseState, baseReasons),
    brokerExposure: exposureMetric(custodyExposure, "BROKER", baseState, baseReasons),
    selfCustodyExposure: exposureMetric(custodyExposure, "SELF_CUSTODY", baseState, baseReasons),
    physicalCustodyExposure: exposureMetric(custodyExposure, "PHYSICAL", baseState, baseReasons),
    violations, strategyViolations,
  };
}

function concentrationMetric(entry: [string, ReturnType<typeof decimal>] | undefined, total: ReturnType<typeof decimal>, state: "OK" | "PARTIAL" | "UNAVAILABLE", reasons: RiskReasonCode[], limit: CalculatePortfolioRiskInput["thresholds"]["singleAssetMaxPercent"], warningCode: RiskReasonCode | null, name: string | null): RiskMetric {
  if (state !== "OK" || !entry) return unavailableMetric(state, reasons);
  const percent = entry[1].div(total).mul(ONE_HUNDRED);
  const warning = limit !== null && percent.greaterThan(decimal(limit));
  return metricFromPercent(percent, warning ? "WARNING" : "OK", entry[0], name, limit === null ? null : toDecimalString(decimal(limit)), [...reasons.filter((reason) => reason === "STALE_PRICE_DATA"), ...(warning && warningCode ? [warningCode] : [])]);
}
function metricFromPercent(value: ReturnType<typeof decimal>, state: "OK" | "WARNING", id: string | null, name: string | null, limit: string | null, reasons: RiskReasonCode[]): RiskMetric { return { valuePercent: toDecimalString(value), state, subjectId: id, subjectName: name, limitPercent: limit, reasonCodes: reasons }; }
function unavailableMetric(state: "OK" | "WARNING" | "PARTIAL" | "UNAVAILABLE", reasons: RiskReasonCode[]): RiskMetric { return { valuePercent: null, state: state === "OK" || state === "WARNING" ? "UNAVAILABLE" : state, subjectId: null, subjectName: null, limitPercent: null, reasonCodes: [...reasons] }; }
function exposureMetric(exposures: RiskExposure[], category: string, state: "OK" | "PARTIAL" | "UNAVAILABLE", reasons: RiskReasonCode[]): RiskMetric { if (state !== "OK") return unavailableMetric(state, reasons); const value = exposures.find((item) => item.category === category)?.valuePercent ?? "0.00"; return metricFromPercent(decimal(value), "OK", category, category, null, []); }
function sumBy(entries: Array<[string, string]>) { const result = new Map<string, ReturnType<typeof decimal>>(); for (const [key, value] of entries) result.set(key, (result.get(key) ?? ZERO).plus(value)); return result; }
function sorted(values: Map<string, ReturnType<typeof decimal>>): Array<[string, ReturnType<typeof decimal>]> { return [...values].sort((a, b) => b[1].comparedTo(a[1])); }
function custodyCategory(account: CalculatePortfolioRiskInput["accounts"][number] | undefined): EngineCustodianCategory { if (account?.custodian) return account.custodian.category; if (account?.type === "EXCHANGE") return "EXCHANGE"; if (account?.type === "BROKER") return "BROKER"; if (account?.type === "WALLET") return "SELF_CUSTODY"; if (account?.type === "PHYSICAL") return "PHYSICAL"; if (account?.type === "BANK") return "BANK"; return "OTHER"; }
