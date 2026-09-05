import { AssetType, TransactionGroupKind, TransactionType } from "@prisma/client";
import { decimal, toDecimalString, ZERO } from "@/features/portfolio-engine/decimal";
import {
  calculatePortfolio,
  compareAllocationToStrategy,
  evaluateStrategyCompliance,
} from "@/features/portfolio-engine/engine";
import { calculatePortfolioRisk } from "@/features/portfolio-engine/risk";
import { activeEngineTransactions } from "@/features/portfolio-engine/transactions";
import type {
  CalculatePortfolioRiskInput,
  DecimalLike,
  EngineAsset,
  EngineStrategyAllocation,
  EngineTransaction,
  MarketPrices,
  PortfolioRiskSnapshot,
  PortfolioSnapshot,
  RiskViolation,
  StrategyWarning,
} from "@/features/portfolio-engine/types";

export type PortfolioReviewState = "NEEDS_REVIEW" | "WATCH" | "CLEAR";
export type PortfolioSignalLifecycle = "NEW" | "ONGOING" | "WORSENED" | "IMPROVED" | "RESOLVED";
export type PortfolioSignalCategory = "STRATEGY" | "RISK" | "CUSTODY" | "CASHFLOW" | "PERFORMANCE" | "DATA_QUALITY" | "MARKET";
export type PortfolioSignalCauseType =
  | "MARKET_PRICE_MOVEMENT"
  | "BUY"
  | "SELL"
  | "TRADE"
  | "CONTRIBUTION"
  | "WITHDRAWAL"
  | "TRANSFER"
  | "FX_MOVEMENT"
  | "DATA_PRICE_UPDATE"
  | "NO_MATERIAL_CHANGE";
export type PortfolioSignalDataQualityState = "COMPLETE" | "STALE" | "PARTIAL" | "UNAVAILABLE";
export type PortfolioSignalDataQualityReason =
  | "NO_COMPARISON_BASELINE"
  | "CURRENT_VALUATION_INCOMPLETE"
  | "PREVIOUS_VALUATION_INCOMPLETE"
  | "STALE_CURRENT_PRICES"
  | "STALE_PREVIOUS_PRICES"
  | "MARKET_DATA_WARNING"
  | "UNASSIGNED_CUSTODIAN";

export type PortfolioPriceObservation = {
  assetId: string;
  symbol: string;
  price: DecimalLike;
  source: string;
  quoteTimestamp: Date | string;
  capturedAt: Date | string;
  isStale: boolean;
};

export type PortfolioReviewBaseline = {
  kind: "PREVIOUS_DAILY_OBSERVATION" | "LAST_REVIEW";
  asOf: Date | string;
  marketPrices: MarketPrices;
  priceObservations: PortfolioPriceObservation[];
  hasStalePrices: boolean;
};

export type PortfolioReviewRules = {
  preferContributionsOverSelling: boolean;
  challengeStrategyViolations: boolean;
  strategyMaterialityPercent: DecimalLike;
  riskMaterialityPercent: DecimalLike;
};

export type PortfolioSignalValue = {
  previous: string | null;
  current: string | null;
  change: string | null;
  unit: "PERCENTAGE_POINTS" | "COUNT";
};

export type PortfolioSignalCause = {
  type: PortfolioSignalCauseType;
  description: string;
  subject: string | null;
  impact: string | null;
};

export type PortfolioSignal = {
  id: string;
  category: PortfolioSignalCategory;
  state: PortfolioReviewState;
  lifecycle: PortfolioSignalLifecycle;
  title: string;
  subject: { kind: "ASSET_CLASS" | "ASSET" | "CUSTODIAN" | "PORTFOLIO" | "MARKET_DATA"; id: string; name: string };
  value: PortfolioSignalValue | null;
  primaryCause: PortfolioSignalCause;
  causes: PortfolioSignalCause[];
  affectedRule: { code: string; description: string; limit: string | null } | null;
  evidence: Array<{ label: string; value: string }>;
  reviewPosture: string;
  dataQuality: { state: PortfolioSignalDataQualityState; reasons: PortfolioSignalDataQualityReason[] };
};

export type PortfolioReview = {
  state: PortfolioReviewState;
  summary: string;
  period: {
    kind: PortfolioReviewBaseline["kind"] | "NO_BASELINE";
    previousAsOf: string | null;
    currentAsOf: string;
  };
  signals: PortfolioSignal[];
  dataQuality: {
    state: PortfolioSignalDataQualityState;
    reasons: PortfolioSignalDataQualityReason[];
    missingPriceSymbols: string[];
    stale: boolean;
    messages: string[];
  };
};

export type CalculatePortfolioReviewInput = {
  assets: EngineAsset[];
  accounts: CalculatePortfolioRiskInput["accounts"];
  transactions: EngineTransaction[];
  baseCurrency: string;
  currentMarketPrices: MarketPrices;
  currentPriceObservations: PortfolioPriceObservation[];
  currentHasStalePrices: boolean;
  marketDataWarning: string | null;
  baseline: PortfolioReviewBaseline | null;
  strategy: EngineStrategyAllocation[] | null;
  rules: PortfolioReviewRules;
  riskThresholds: CalculatePortfolioRiskInput["thresholds"];
  asOf: Date | string;
};

const causePriority: PortfolioSignalCauseType[] = [
  "CONTRIBUTION", "WITHDRAWAL", "TRADE", "BUY", "SELL", "TRANSFER",
  "FX_MOVEMENT", "MARKET_PRICE_MOVEMENT", "DATA_PRICE_UPDATE", "NO_MATERIAL_CHANGE",
];

export function calculatePortfolioReview(input: CalculatePortfolioReviewInput): PortfolioReview {
  const asOf = new Date(input.asOf);
  if (!Number.isFinite(asOf.getTime())) throw new Error("Portfolio Review requires a valid as-of date.");

  const transactions = activeEngineTransactions(input.transactions);
  const currentTransactions = transactionsThrough(transactions, asOf.getTime());
  const currentPortfolio = calculatePortfolio({
    assets: input.assets,
    transactions: currentTransactions,
    marketPrices: input.currentMarketPrices,
  });
  const currentRisk = calculatePortfolioRisk({
    portfolio: currentPortfolio,
    assets: input.assets,
    accounts: input.accounts,
    strategy: input.strategy,
    thresholds: input.riskThresholds,
    hasStalePrices: input.currentHasStalePrices,
  });

  const baselineDate = input.baseline ? new Date(input.baseline.asOf) : null;
  const baselineTimestamp = baselineDate?.getTime() ?? null;
  const previousTransactions = baselineTimestamp === null ? [] : transactionsThrough(transactions, baselineTimestamp);
  const previousPortfolio = input.baseline
    ? calculatePortfolio({ assets: input.assets, transactions: previousTransactions, marketPrices: input.baseline.marketPrices })
    : null;
  const marketOnlyPortfolio = input.baseline
    ? calculatePortfolio({ assets: input.assets, transactions: previousTransactions, marketPrices: input.currentMarketPrices })
    : null;
  const previousRisk = previousPortfolio && input.baseline
    ? calculatePortfolioRisk({
      portfolio: previousPortfolio,
      assets: input.assets,
      accounts: input.accounts,
      strategy: input.strategy,
      thresholds: input.riskThresholds,
      hasStalePrices: input.baseline.hasStalePrices,
    })
    : null;
  const intervalTransactions = baselineTimestamp === null
    ? []
    : currentTransactions.filter((transaction) => transactionTime(transaction) > baselineTimestamp);

  const dataQuality = buildDataQuality(input, currentPortfolio, previousPortfolio, currentRisk);
  const context: SignalContext = {
    input,
    previousTransactions,
    previousPortfolio,
    marketOnlyPortfolio,
    currentPortfolio,
    previousRisk,
    currentRisk,
    intervalTransactions,
    dataQuality: { state: dataQuality.state, reasons: dataQuality.reasons },
  };
  const signals: PortfolioSignal[] = [];
  signals.push(...buildDataQualitySignals(context));
  signals.push(...buildCustodySignals(context));

  const exactComparison = Boolean(
    input.baseline && previousPortfolio &&
    previousPortfolio.missingPriceSymbols.length === 0 &&
    currentPortfolio.missingPriceSymbols.length === 0 &&
    !input.baseline.hasStalePrices &&
    !input.currentHasStalePrices,
  );
  if (exactComparison) {
    signals.push(...buildStrategySignals(context));
    signals.push(...buildRiskSignals(context));
  }

  signals.sort(compareSignals);
  const state = signals.some((signal) => signal.state === "NEEDS_REVIEW")
    ? "NEEDS_REVIEW"
    : signals.some((signal) => signal.state === "WATCH")
      ? "WATCH"
      : dataQuality.state === "COMPLETE"
        ? "CLEAR"
        : "WATCH";

  return {
    state,
    summary: state === "NEEDS_REVIEW"
      ? "One or more portfolio changes need review."
      : state === "WATCH"
        ? "No immediate portfolio change is implied, but some conditions should be watched."
        : "Portfolio is clear.",
    period: {
      kind: input.baseline?.kind ?? "NO_BASELINE",
      previousAsOf: baselineDate?.toISOString() ?? null,
      currentAsOf: asOf.toISOString(),
    },
    signals,
    dataQuality,
  };
}

type SignalContext = {
  input: CalculatePortfolioReviewInput;
  previousTransactions: EngineTransaction[];
  previousPortfolio: PortfolioSnapshot | null;
  marketOnlyPortfolio: PortfolioSnapshot | null;
  currentPortfolio: PortfolioSnapshot;
  previousRisk: PortfolioRiskSnapshot | null;
  currentRisk: PortfolioRiskSnapshot;
  intervalTransactions: EngineTransaction[];
  dataQuality: PortfolioSignal["dataQuality"];
};

function buildStrategySignals(context: SignalContext): PortfolioSignal[] {
  if (!context.input.strategy || !context.previousPortfolio) return [];
  const previousWarnings = evaluateStrategyCompliance(context.previousPortfolio, context.input.strategy);
  const currentWarnings = evaluateStrategyCompliance(context.currentPortfolio, context.input.strategy);
  const previousByCode = new Map(previousWarnings.map((warning) => [warning.code, warning]));
  const currentByCode = new Map(currentWarnings.map((warning) => [warning.code, warning]));
  const codes = [...new Set([...previousByCode.keys(), ...currentByCode.keys()])].sort();
  const previousComparisons = new Map(compareAllocationToStrategy(context.previousPortfolio, context.input.strategy).map((item) => [item.assetClass, item]));
  const currentComparisons = new Map(compareAllocationToStrategy(context.currentPortfolio, context.input.strategy).map((item) => [item.assetClass, item]));
  const materiality = decimal(context.input.rules.strategyMaterialityPercent).abs();

  return codes.map((code) => {
    const previous = previousByCode.get(code);
    const current = currentByCode.get(code);
    const reference = current ?? previous!;
    const previousExcess = previous ? warningExcess(previous) : ZERO;
    const currentExcess = current ? warningExcess(current) : ZERO;
    const lifecycle = signalLifecycle(previous, current, previousExcess, currentExcess, materiality);
    const comparison = currentComparisons.get(reference.assetClass);
    const currentDrift = comparison ? decimal(comparison.driftFromTarget).abs() : currentExcess;
    const material = currentDrift.greaterThanOrEqualTo(materiality);
    const state: PortfolioReviewState = lifecycle === "RESOLVED"
      ? "CLEAR"
      : (lifecycle === "NEW" || lifecycle === "WORSENED") && material && context.input.rules.challengeStrategyViolations
        ? "NEEDS_REVIEW"
        : "WATCH";
    const causes = attributionCauses(context, { kind: "ASSET_CLASS", id: reference.assetClass, name: titleCase(reference.assetClass) });
    const direction = code.endsWith("ABOVE_MAX") ? "maximum" : "minimum";
    return {
      id: `STRATEGY:${code}`,
      category: "STRATEGY",
      state,
      lifecycle,
      title: strategyTitle(reference, lifecycle, direction),
      subject: { kind: "ASSET_CLASS", id: reference.assetClass, name: `${titleCase(reference.assetClass)} allocation` },
      value: percentChange(
        previousComparisons.get(reference.assetClass)?.currentPercent ?? null,
        currentComparisons.get(reference.assetClass)?.currentPercent ?? null,
      ),
      primaryCause: causes[0],
      causes,
      affectedRule: { code, description: `${titleCase(reference.assetClass)} ${direction} ${reference.limitPercent}%`, limit: reference.limitPercent },
      evidence: [
        { label: "Lifecycle", value: titleCase(lifecycle) },
        { label: "Distance beyond range", value: `${toDecimalString(lifecycle === "RESOLVED" ? previousExcess : currentExcess)} pp` },
      ],
      reviewPosture: lifecycle === "RESOLVED"
        ? "No review is required for this rule."
        : context.input.rules.preferContributionsOverSelling
          ? "Review future contribution direction before changing existing holdings."
          : "Review the allocation against the saved strategy; this is not a trading instruction.",
      dataQuality: context.dataQuality,
    };
  });
}

function buildRiskSignals(context: SignalContext): PortfolioSignal[] {
  if (!context.previousRisk) return [];
  const previousById = new Map(context.previousRisk.violations.map((violation) => [riskIdentity(violation), violation]));
  const currentById = new Map(context.currentRisk.violations.map((violation) => [riskIdentity(violation), violation]));
  const ids = [...new Set([...previousById.keys(), ...currentById.keys()])].sort();
  const materiality = decimal(context.input.rules.riskMaterialityPercent).abs();

  return ids.map((id) => {
    const previous = previousById.get(id);
    const current = currentById.get(id);
    const reference = current ?? previous!;
    const lifecycle = signalLifecycle(
      previous,
      current,
      previous ? decimal(previous.excessPercent) : ZERO,
      current ? decimal(current.excessPercent) : ZERO,
      materiality,
    );
    const state: PortfolioReviewState = lifecycle === "RESOLVED"
      ? "CLEAR"
      : lifecycle === "NEW" || lifecycle === "WORSENED"
        ? "NEEDS_REVIEW"
        : "WATCH";
    const category = reference.code === "CUSTODIAN_LIMIT_EXCEEDED" ? "CUSTODY" as const : "RISK" as const;
    const subjectKind = category === "CUSTODY" ? "CUSTODIAN" as const : "ASSET" as const;
    const subject = { kind: subjectKind, id: reference.subjectId, name: reference.subjectName };
    const causes = attributionCauses(context, subject);
    const previousPercent = context.previousPortfolio ? portfolioMetric(context, context.previousPortfolio, subject) : null;
    const currentPercent = portfolioMetric(context, context.currentPortfolio, subject);
    return {
      id: `${category}:${reference.code}:${reference.subjectId}`,
      category,
      state,
      lifecycle,
      title: riskTitle(reference, lifecycle),
      subject,
      value: percentChange(decimalString(previousPercent), decimalString(currentPercent)),
      primaryCause: causes[0],
      causes,
      affectedRule: { code: reference.code, description: `${riskRuleLabel(reference)} ${reference.limitPercent}%`, limit: reference.limitPercent },
      evidence: [
        { label: "Lifecycle", value: titleCase(lifecycle) },
        { label: "Limit excess", value: `${lifecycle === "RESOLVED" ? previous!.excessPercent : current!.excessPercent} pp` },
      ],
      reviewPosture: lifecycle === "RESOLVED"
        ? "No review is required for this limit."
        : "Review the concentration before adding exposure; no trade is implied.",
      dataQuality: context.dataQuality,
    };
  });
}

function buildDataQuality(input: CalculatePortfolioReviewInput, current: PortfolioSnapshot, previous: PortfolioSnapshot | null, risk: PortfolioRiskSnapshot): PortfolioReview["dataQuality"] {
  const reasons: PortfolioSignalDataQualityReason[] = [];
  const messages: string[] = [];
  if (!input.baseline) {
    reasons.push("NO_COMPARISON_BASELINE");
    messages.push("No earlier price observation is available for deterministic change comparison.");
  }
  if (current.missingPriceSymbols.length > 0) {
    reasons.push("CURRENT_VALUATION_INCOMPLETE");
    messages.push(`Current valuation is missing prices for ${current.missingPriceSymbols.join(", ")}.`);
  }
  if (previous && previous.missingPriceSymbols.length > 0) {
    reasons.push("PREVIOUS_VALUATION_INCOMPLETE");
    messages.push(`The comparison observation is missing prices for ${previous.missingPriceSymbols.join(", ")}.`);
  }
  if (input.currentHasStalePrices) {
    reasons.push("STALE_CURRENT_PRICES");
    messages.push("At least one current price is stale.");
  }
  if (input.baseline?.hasStalePrices) {
    reasons.push("STALE_PREVIOUS_PRICES");
    messages.push("At least one comparison price was stale when captured.");
  }
  if (input.marketDataWarning) {
    reasons.push("MARKET_DATA_WARNING");
    messages.push(input.marketDataWarning);
  }
  if (risk.unassignedCustodianAccountIds.length > 0) {
    reasons.push("UNASSIGNED_CUSTODIAN");
    messages.push(`${risk.unassignedCustodianAccountIds.length} valued account(s) have no assigned custodian.`);
  }
  const missingPriceSymbols = [...new Set([
    ...current.missingPriceSymbols,
    ...(previous?.missingPriceSymbols ?? []),
  ])].sort();
  const stale = input.currentHasStalePrices || Boolean(input.baseline?.hasStalePrices);
  const unavailable = decimal(current.totalValue).lessThanOrEqualTo(ZERO) && current.holdings.length > 0;
  const state: PortfolioSignalDataQualityState = unavailable
    ? "UNAVAILABLE"
    : reasons.some((reason) => reason.includes("INCOMPLETE") || reason === "NO_COMPARISON_BASELINE" || reason === "UNASSIGNED_CUSTODIAN" || reason === "MARKET_DATA_WARNING")
      ? "PARTIAL"
      : stale
        ? "STALE"
        : "COMPLETE";
  return { state, reasons: [...new Set(reasons)], missingPriceSymbols, stale, messages: [...new Set(messages)] };
}

function buildDataQualitySignals(context: SignalContext): PortfolioSignal[] {
  const signals: PortfolioSignal[] = [];
  const quality = context.dataQuality;
  const add = (id: string, title: string, state: PortfolioReviewState, lifecycle: PortfolioSignalLifecycle, evidence: Array<{ label: string; value: string }>) => {
    const causes = [cause("DATA_PRICE_UPDATE", "Recorded price coverage or freshness changed.", null, null)];
    signals.push({
      id: `DATA_QUALITY:${id}`,
      category: "DATA_QUALITY",
      state,
      lifecycle,
      title,
      subject: { kind: "MARKET_DATA", id, name: "Portfolio data" },
      value: null,
      primaryCause: causes[0],
      causes,
      affectedRule: null,
      evidence,
      reviewPosture: state === "NEEDS_REVIEW"
        ? "Resolve price coverage before relying on exact portfolio conclusions."
        : "Treat the comparison as provisional until complete fresh data is available.",
      dataQuality: quality,
    });
  };

  if (!context.input.baseline) add("NO_BASELINE", "Comparison baseline is not available yet", "WATCH", "NEW", [{ label: "Data", value: "Current facts only" }]);
  if (context.currentPortfolio.missingPriceSymbols.length > 0) {
    const wasMissing = Boolean(context.previousPortfolio?.missingPriceSymbols.length);
    add("CURRENT_PRICES", "Current valuation is incomplete", "NEEDS_REVIEW", wasMissing ? "ONGOING" : "NEW", [{ label: "Missing prices", value: context.currentPortfolio.missingPriceSymbols.join(", ") }]);
  } else if (context.previousPortfolio?.missingPriceSymbols.length) {
    add("PREVIOUS_PRICES", "Current price coverage was restored", "CLEAR", "RESOLVED", [{ label: "Previously missing prices", value: context.previousPortfolio.missingPriceSymbols.join(", ") }]);
  }
  if (context.input.currentHasStalePrices || context.input.baseline?.hasStalePrices) {
    add("STALE_PRICES", "Price observations are stale", "WATCH", "ONGOING", [{ label: "Data", value: "Current or comparison prices are stale" }]);
  }
  if (context.input.marketDataWarning) add("MARKET_WARNING", "Market data provider reported a warning", "WATCH", "NEW", [{ label: "Provider", value: context.input.marketDataWarning }]);
  return signals;
}

function buildCustodySignals(context: SignalContext): PortfolioSignal[] {
  const current = context.currentRisk.unassignedCustodianAccountIds;
  const previous = context.previousRisk?.unassignedCustodianAccountIds ?? [];
  if (current.length === 0 && previous.length === 0) return [];
  const lifecycle: PortfolioSignalLifecycle = current.length === 0
    ? "RESOLVED"
    : previous.length === 0
      ? "NEW"
      : current.length > previous.length
        ? "WORSENED"
        : current.length < previous.length
          ? "IMPROVED"
          : "ONGOING";
  const causes = attributionCauses(context, { kind: "PORTFOLIO", id: "custody-coverage", name: "Custody coverage" });
  return [{
    id: "CUSTODY:UNASSIGNED_CUSTODIAN",
    category: "CUSTODY",
    state: lifecycle === "RESOLVED" ? "CLEAR" : "WATCH",
    lifecycle,
    title: lifecycle === "RESOLVED" ? "Custodian coverage is complete" : "Some valued accounts have no assigned custodian",
    subject: { kind: "PORTFOLIO", id: "custody-coverage", name: "Custody coverage" },
    value: { previous: String(previous.length), current: String(current.length), change: String(current.length - previous.length), unit: "COUNT" },
    primaryCause: causes[0],
    causes,
    affectedRule: null,
    evidence: [{ label: "Unassigned valued accounts", value: String(current.length) }],
    reviewPosture: lifecycle === "RESOLVED" ? "No review is required." : "Assign custodians before relying on custodian concentration conclusions.",
    dataQuality: context.dataQuality,
  }];
}

function attributionCauses(context: SignalContext, subject: PortfolioSignal["subject"]): PortfolioSignalCause[] {
  const causes: PortfolioSignalCause[] = [];
  const batches = transactionBatches(context.intervalTransactions);
  let ledgerTransactions = [...context.previousTransactions];
  let beforePortfolio = context.marketOnlyPortfolio;
  for (const batch of batches) {
    ledgerTransactions = [...ledgerTransactions, ...batch];
    const afterPortfolio = calculatePortfolio({
      assets: context.input.assets,
      transactions: ledgerTransactions,
      marketPrices: context.input.currentMarketPrices,
    });
    const beforeMetric = beforePortfolio ? portfolioMetric(context, beforePortfolio, subject) : null;
    const afterMetric = portfolioMetric(context, afterPortfolio, subject);
    const impact = beforeMetric === null || afterMetric === null ? null : afterMetric.minus(beforeMetric);
    beforePortfolio = afterPortfolio;
    if (impact === null || impact.equals(ZERO)) continue;
    const type = transactionCauseType(batch);
    const symbols = [...new Set(batch.map((transaction) => context.input.assets.find((asset) => asset.id === transaction.assetId)?.symbol).filter(Boolean))] as string[];
    causes.push(cause(type, transactionCauseDescription(type, symbols), symbols.join(" → ") || null, toDecimalString(impact)));
  }

  const marketCause = dominantMarketCause(context, subject);
  if (marketCause) causes.push(marketCause);
  if (causes.length === 0) causes.push(cause("NO_MATERIAL_CHANGE", "No material ledger or price change was identified for this condition.", subject.name, null));
  return causes.sort(compareCauses);
}

function dominantMarketCause(context: SignalContext, subject: PortfolioSignal["subject"]): PortfolioSignalCause | null {
  if (!context.previousPortfolio || !context.marketOnlyPortfolio || !context.input.baseline) return null;
  const previousMetric = portfolioMetric(context, context.previousPortfolio, subject);
  const marketMetric = portfolioMetric(context, context.marketOnlyPortfolio, subject);
  if (previousMetric === null || marketMetric === null) return null;
  const metricImpact = marketMetric.minus(previousMetric);
  if (metricImpact.equals(ZERO)) return null;
  const previousObservations = new Map(context.input.baseline.priceObservations.map((observation) => [observation.assetId, observation]));
  const currentObservations = new Map(context.input.currentPriceObservations.map((observation) => [observation.assetId, observation]));
  const quantities = new Map<string, ReturnType<typeof decimal>>();
  for (const holding of context.previousPortfolio.holdings) {
    quantities.set(holding.assetId, (quantities.get(holding.assetId) ?? ZERO).plus(holding.quantity));
  }
  let dominant: { asset: EngineAsset; impact: ReturnType<typeof decimal>; dataUpdate: boolean } | null = null;
  for (const [assetId, quantity] of quantities) {
    const asset = context.input.assets.find((candidate) => candidate.id === assetId);
    const previous = previousObservations.get(assetId);
    const current = currentObservations.get(assetId);
    if (!asset || !previous || !current) continue;
    const impact = quantity.mul(decimal(current.price).minus(previous.price));
    if (impact.equals(ZERO)) continue;
    const dataUpdate = previous.source !== current.source || previous.isStale !== current.isStale;
    if (!dominant || impact.abs().greaterThan(dominant.impact.abs()) || (impact.abs().equals(dominant.impact.abs()) && asset.symbol.localeCompare(dominant.asset.symbol) < 0)) {
      dominant = { asset, impact, dataUpdate };
    }
  }
  if (!dominant) return null;
  const type: PortfolioSignalCauseType = dominant.dataUpdate
    ? "DATA_PRICE_UPDATE"
    : dominant.asset.assetType === AssetType.FIAT && dominant.asset.currency?.toUpperCase() !== context.input.baseCurrency.toUpperCase()
      ? "FX_MOVEMENT"
      : "MARKET_PRICE_MOVEMENT";
  const direction = dominant.impact.greaterThan(ZERO) ? "appreciation" : "depreciation";
  return cause(type, dominant.dataUpdate ? `${dominant.asset.symbol} price observation changed source or freshness.` : `${dominant.asset.symbol} ${type === "FX_MOVEMENT" ? "FX" : "market"} ${direction}.`, dominant.asset.symbol, toDecimalString(metricImpact));
}

function portfolioMetric(context: SignalContext, portfolio: PortfolioSnapshot, subject: PortfolioSignal["subject"]) {
  if (subject.kind === "MARKET_DATA") return null;
  if (subject.kind === "PORTFOLIO") {
    const unassigned = new Set(
      portfolio.valuedHoldings
        .filter((holding) => decimal(holding.value).greaterThan(ZERO))
        .filter((holding) => !context.input.accounts.find((account) => account.id === holding.accountId)?.custodian)
        .map((holding) => holding.accountId),
    );
    return decimal(unassigned.size);
  }
  const total = decimal(portfolio.totalValue);
  if (total.lessThanOrEqualTo(ZERO)) return null;
  const value = portfolio.valuedHoldings.reduce((sum, holding) => {
    const asset = context.input.assets.find((candidate) => candidate.id === holding.assetId);
    const account = context.input.accounts.find((candidate) => candidate.id === holding.accountId);
    const matches = subject.kind === "ASSET_CLASS"
      ? asset?.assetClass === subject.id
      : subject.kind === "ASSET"
        ? holding.assetId === subject.id
        : account?.custodian?.id === subject.id;
    return matches ? sum.plus(holding.value) : sum;
  }, ZERO);
  return value.div(total).mul(100);
}

function transactionBatches(transactions: EngineTransaction[]) {
  const byId = new Map<string, EngineTransaction[]>();
  for (const transaction of transactions) {
    const key = transaction.transactionGroupId ? `group:${transaction.transactionGroupId}` : `transaction:${transaction.id ?? `${transaction.assetId}:${transactionTime(transaction)}`}`;
    const batch = byId.get(key) ?? [];
    batch.push(transaction);
    byId.set(key, batch);
  }
  return [...byId.values()].sort((left, right) => transactionTime(left[0]) - transactionTime(right[0]));
}

function transactionCauseType(batch: EngineTransaction[]): PortfolioSignalCauseType {
  if (batch.some((transaction) => transaction.transactionGroup?.kind === TransactionGroupKind.TRADE)) return "TRADE";
  if (batch.some((transaction) => transaction.transactionGroup?.kind === TransactionGroupKind.TRANSFER || transaction.type === TransactionType.TRANSFER_IN || transaction.type === TransactionType.TRANSFER_OUT)) return "TRANSFER";
  if (batch.some((transaction) => transaction.type === TransactionType.DEPOSIT)) return "CONTRIBUTION";
  if (batch.some((transaction) => transaction.type === TransactionType.WITHDRAWAL)) return "WITHDRAWAL";
  if (batch.some((transaction) => transaction.type === TransactionType.BUY)) return "BUY";
  return "SELL";
}

function signalLifecycle<T>(previous: T | undefined, current: T | undefined, previousExcess: ReturnType<typeof decimal>, currentExcess: ReturnType<typeof decimal>, threshold: ReturnType<typeof decimal>): PortfolioSignalLifecycle {
  if (!previous && current) return "NEW";
  if (previous && !current) return "RESOLVED";
  const change = currentExcess.minus(previousExcess);
  if (change.greaterThanOrEqualTo(threshold) && !change.equals(ZERO)) return "WORSENED";
  if (change.lessThanOrEqualTo(threshold.negated()) && !change.equals(ZERO)) return "IMPROVED";
  return "ONGOING";
}

function warningExcess(warning: StrategyWarning) {
  return warning.code.endsWith("ABOVE_MAX")
    ? decimal(warning.currentPercent).minus(warning.limitPercent).abs()
    : decimal(warning.limitPercent).minus(warning.currentPercent).abs();
}

function percentChange(previous: string | null, current: string | null): PortfolioSignalValue {
  return {
    previous,
    current,
    change: previous === null || current === null ? null : toDecimalString(decimal(current).minus(previous)),
    unit: "PERCENTAGE_POINTS",
  };
}

function decimalString(value: ReturnType<typeof decimal> | null) {
  return value === null ? null : toDecimalString(value.toDecimalPlaces(2));
}

function riskIdentity(violation: RiskViolation) {
  return `${violation.code}:${violation.subjectId}`;
}

function riskRuleLabel(violation: RiskViolation) {
  return violation.code === "CUSTODIAN_LIMIT_EXCEEDED" ? "Custodian maximum" : "Single asset maximum";
}

function riskTitle(violation: RiskViolation, lifecycle: PortfolioSignalLifecycle) {
  if (lifecycle === "NEW") return `${violation.subjectName} crossed its configured concentration limit`;
  if (lifecycle === "WORSENED") return `${violation.subjectName} concentration moved farther beyond its limit`;
  if (lifecycle === "IMPROVED") return `${violation.subjectName} concentration improved but remains above its limit`;
  if (lifecycle === "RESOLVED") return `${violation.subjectName} concentration returned within its limit`;
  return `${violation.subjectName} remains above its concentration limit`;
}

function strategyTitle(warning: StrategyWarning, lifecycle: PortfolioSignalLifecycle, direction: string) {
  const subject = `${titleCase(warning.assetClass)} allocation`;
  if (lifecycle === "NEW") return `${subject} crossed configured ${direction}`;
  if (lifecycle === "WORSENED") return `${subject} moved farther outside its configured range`;
  if (lifecycle === "IMPROVED") return `${subject} improved but remains outside its configured range`;
  if (lifecycle === "RESOLVED") return `${subject} returned to its configured range`;
  return `${subject} remains outside its configured range`;
}

function transactionCauseDescription(type: PortfolioSignalCauseType, symbols: string[]) {
  const subject = symbols.join(" → ") || "Portfolio";
  if (type === "TRADE") return `${subject} trade changed portfolio composition.`;
  if (type === "TRANSFER") return `${subject} transfer changed account or custody exposure.`;
  if (type === "CONTRIBUTION") return `${subject} contribution changed portfolio composition.`;
  if (type === "WITHDRAWAL") return `${subject} withdrawal changed portfolio composition.`;
  if (type === "BUY") return `${subject} purchase changed portfolio composition.`;
  return `${subject} sale changed portfolio composition.`;
}

function cause(type: PortfolioSignalCauseType, description: string, subject: string | null, impact: string | null): PortfolioSignalCause {
  return { type, description, subject, impact };
}

function compareCauses(left: PortfolioSignalCause, right: PortfolioSignalCause) {
  const leftImpact = left.impact === null ? ZERO : decimal(left.impact).abs();
  const rightImpact = right.impact === null ? ZERO : decimal(right.impact).abs();
  const impactOrder = rightImpact.comparedTo(leftImpact);
  return impactOrder || causePriority.indexOf(left.type) - causePriority.indexOf(right.type) || left.description.localeCompare(right.description);
}

function compareSignals(left: PortfolioSignal, right: PortfolioSignal) {
  const stateOrder = { NEEDS_REVIEW: 0, WATCH: 1, CLEAR: 2 };
  const lifecycleOrder = { NEW: 0, WORSENED: 1, ONGOING: 2, IMPROVED: 3, RESOLVED: 4 };
  return stateOrder[left.state] - stateOrder[right.state]
    || lifecycleOrder[left.lifecycle] - lifecycleOrder[right.lifecycle]
    || left.id.localeCompare(right.id);
}

function transactionsThrough(transactions: EngineTransaction[], timestamp: number) {
  return transactions.filter((transaction) => transactionTime(transaction) <= timestamp);
}

function transactionTime(transaction: EngineTransaction) {
  if (!transaction.executedAt) return Number.NEGATIVE_INFINITY;
  const timestamp = new Date(transaction.executedAt).getTime();
  return Number.isFinite(timestamp) ? timestamp : Number.NEGATIVE_INFINITY;
}

function titleCase(value: string) {
  return value.toLowerCase().replaceAll("_", " ").replace(/(^|\s)\S/g, (letter) => letter.toUpperCase());
}
