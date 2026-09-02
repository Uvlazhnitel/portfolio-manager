import type { Responses } from "openai/resources/responses/responses";
import {
  buildContributionProjection,
  calculatePortfolioScenario,
  type ContributionProjection,
  type PortfolioScenarioResult,
} from "@/features/portfolio-engine";
import type { AssistantPortfolioRuntime } from "@/features/assistant/context";
import { createAssistantToolServices, type AssistantToolServices } from "@/features/assistant/tool-services";
import { explainContributionPlanToolSchema, simulateScenarioToolSchema } from "@/features/assistant/validation";

export const assistantToolDefinitions: Responses.Tool[] = [
  tool("get_portfolio_summary", "Return deterministic current portfolio value, allocation, price coverage, holdings, accounts, and strategy violations. Use it for current portfolio facts."),
  tool("get_strategy", "Return the saved long-term strategy, allocation targets, ranges, and portfolio rules."),
  tool("get_daily_brief", "Return the existing deterministic Daily Brief. Use it for questions about what changed since the previous complete daily observation."),
  tool("get_risk_snapshot", "Return the shared deterministic Risk Engine snapshot. Use it for every portfolio risk, concentration, custody, or crypto exposure question."),
  tool("get_performance_summary", "Return deterministic Performance metrics and compact benchmark results. Use it for P&L, cashflow-adjusted return, XIRR, YTD, 1Y, drawdown, or benchmark questions."),
  {
    type: "function",
    name: "explain_contribution_plan",
    description: "Return the existing deterministic Contribution Planner result. Pass a base-currency amount to calculate a plan, or null to read the latest saved plan.",
    strict: true,
    parameters: {
      type: "object",
      properties: { amount: { type: ["string", "null"], description: "Positive base-currency amount with at most two decimals, or null for the saved plan." } },
      required: ["amount"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "simulate_scenario",
    description: "Run a deterministic read-only EXTERNAL_BUY, SELL, CONTRIBUTION, or TRADE scenario. External buys/contributions need a destination account when multiple accounts exist. Use TRADE only when the user names an existing funding asset.",
    strict: true,
    parameters: {
      type: "object",
      properties: {
        symbol: { type: "string", description: "Existing destination/requested asset symbol, for example BTC." },
        kind: { type: "string", enum: ["BUY", "EXTERNAL_BUY", "SELL", "CONTRIBUTION", "TRADE"] },
        amount: { type: "string", description: "Positive amount in the portfolio base currency with at most two decimals. For TRADE, this is the source amount." },
        accountName: { type: ["string", "null"], description: "Exact existing account name for legacy BUY/EXTERNAL_BUY/SELL/CONTRIBUTION, or null for deterministic safe resolution." },
        sourceSymbol: { type: ["string", "null"], description: "Existing funding asset symbol for TRADE, for example USDT. Must be null for non-trade scenarios." },
        sourceAccountName: { type: ["string", "null"], description: "Exact source account name for TRADE, or null for deterministic safe resolution." },
        destinationAccountName: { type: ["string", "null"], description: "Exact destination account name for TRADE, or null to use the source account." },
        fee: { type: ["string", "null"], description: "Optional non-negative base-currency trade fee with at most two decimals, or null." },
      },
      required: ["symbol", "kind", "amount", "accountName", "sourceSymbol", "sourceAccountName", "destinationAccountName", "fee"],
      additionalProperties: false,
    },
  },
];

export async function executeAssistantTool(
  name: string,
  rawArguments: string,
  runtime: AssistantPortfolioRuntime,
  services: AssistantToolServices = createAssistantToolServices(),
) {
  const argumentsValue = parseArguments(rawArguments);

  if (name === "get_portfolio_summary") return portfolioSummary(runtime);
  if (name === "get_strategy") return { baseCurrency: runtime.context.baseCurrency, strategy: runtime.context.strategy, allocations: runtime.context.strategy?.allocations ?? [] };
  if (name === "get_daily_brief") return compactDailyBrief(await services.getDailyBrief());
  if (name === "get_risk_snapshot") {
    return {
      baseCurrency: runtime.context.baseCurrency,
      valuation: {
        totalPortfolioValue: runtime.context.valuation.totalPortfolioValue,
        exactTotalValue: runtime.context.valuation.exactTotalValue,
        knownValuedSubtotal: runtime.context.valuation.knownValuedSubtotal,
        isPartial: runtime.context.valuation.isPartial,
        priceCoveragePercent: runtime.context.valuation.priceCoveragePercent,
      },
      risk: runtime.context.risk,
      dataQuality: {
        state: runtime.context.risk.state,
        isStale: runtime.context.risk.isStale,
        missingPriceSymbols: runtime.context.risk.missingPriceSymbols,
        unassignedCustodianAccountIds: runtime.context.risk.unassignedCustodianAccountIds,
      },
    };
  }
  if (name === "get_performance_summary") return compactPerformance(await services.getPerformance());

  if (name === "explain_contribution_plan") {
    const parsed = explainContributionPlanToolSchema.parse(argumentsValue);
    if (!runtime.strategy) return unavailable("STRATEGY_NOT_CONFIGURED");
    if (runtime.context.valuation.isPartial) {
      return unavailable("INCOMPLETE_VALUATION", {
        missingPriceSymbols: runtime.context.valuation.missingPriceSymbols,
        reasonCodes: ["INCOMPLETE_VALUATION", "MISSING_MARKET_PRICE"],
      });
    }
    if (parsed.amount === null) {
      return runtime.context.latestContributionRecommendation
        ? { status: "AVAILABLE", currency: runtime.strategy.baseCurrency, ...runtime.context.latestContributionRecommendation }
        : unavailable("CONTRIBUTION_PLAN_NOT_CONFIGURED");
    }
    return contributionOutput(buildContributionProjection({
      portfolio: runtime.portfolio,
      assets: runtime.assets,
      strategy: runtime.strategy.allocations,
      contributionAmount: parsed.amount,
    }), runtime.strategy.baseCurrency);
  }

  if (name === "simulate_scenario") {
    const parsed = simulateScenarioToolSchema.parse(argumentsValue);
    const asset = runtime.assets.find((candidate) => candidate.symbol.toUpperCase() === parsed.symbol);
    if (!asset) return unavailable("ASSET_NOT_FOUND", { symbol: parsed.symbol });
    if (runtime.context.valuation.isPartial) {
      return unavailable("INCOMPLETE_VALUATION", {
        missingPriceSymbols: runtime.context.valuation.missingPriceSymbols,
        reasonCodes: ["INCOMPLETE_VALUATION", "MISSING_MARKET_PRICE"],
      });
    }

    if (parsed.kind === "TRADE") {
      if (!parsed.sourceSymbol) return unavailable("SOURCE_ASSET_REQUIRED");
      const sourceAsset = runtime.assets.find((candidate) => candidate.symbol.toUpperCase() === parsed.sourceSymbol);
      if (!sourceAsset) return unavailable("SOURCE_ASSET_REQUIRED", { symbol: parsed.sourceSymbol });
      const account = resolveTradeAccounts(runtime, sourceAsset.id, parsed.sourceAccountName, parsed.destinationAccountName);
      if ("reasonCode" in account) return unavailable(account.reasonCode, { accounts: account.candidates });
      if (runtime.marketPrices[sourceAsset.symbol] === undefined) return unavailable("MISSING_MARKET_PRICE", { symbol: sourceAsset.symbol });
      if (runtime.marketPrices[asset.symbol] === undefined) return unavailable("MISSING_MARKET_PRICE", { symbol: asset.symbol });
      let scenario: PortfolioScenarioResult;
      try {
        scenario = calculatePortfolioScenario({
          assets: runtime.assets,
          transactions: runtime.transactions,
          marketPrices: runtime.marketPrices,
          accounts: engineAccounts(runtime),
          strategy: runtime.strategy?.allocations ?? null,
          riskThresholds: runtime.riskThresholds,
          hasStalePrices: runtime.hasStalePrices,
          baseCurrency: runtime.context.baseCurrency,
          accountId: account.destination.id,
          assetId: asset.id,
          kind: parsed.kind,
          amount: parsed.amount,
          sourceAssetId: sourceAsset.id,
          sourceAccountId: account.source.id,
          destinationAssetId: asset.id,
          destinationAccountId: account.destination.id,
          sourceAmount: parsed.amount,
          fee: parsed.fee ?? "0",
        });
      } catch (error) {
        if (error instanceof Error && error.message.includes("Sell amount exceeds")) {
          return unavailable("INSUFFICIENT_SOURCE_HOLDING", { accountName: account.source.name, symbol: sourceAsset.symbol });
        }
        throw error;
      }
      return scenarioOutput(scenario, account.destination.name, runtime);
    }

    const account = resolveScenarioAccount(runtime, asset.id, parsed.accountName, parsed.kind);
    if ("reasonCode" in account) return unavailable(account.reasonCode, { accounts: account.candidates });
    if (runtime.marketPrices[asset.symbol] === undefined) return unavailable("MISSING_MARKET_PRICE", { symbol: asset.symbol });
    let scenario: PortfolioScenarioResult;
    try {
      scenario = calculatePortfolioScenario({
        assets: runtime.assets,
        transactions: runtime.transactions,
        marketPrices: runtime.marketPrices,
        accounts: engineAccounts(runtime),
        strategy: runtime.strategy?.allocations ?? null,
        riskThresholds: runtime.riskThresholds,
        hasStalePrices: runtime.hasStalePrices,
        baseCurrency: runtime.context.baseCurrency,
        accountId: account.id,
        assetId: asset.id,
        kind: parsed.kind,
        amount: parsed.amount,
      });
    } catch (error) {
      if (error instanceof Error && error.message.includes("Sell amount exceeds")) {
        return unavailable("INSUFFICIENT_ACCOUNT_HOLDING", { accountName: account.name, symbol: asset.symbol });
      }
      throw error;
    }
    return scenarioOutput(scenario, account.name, runtime);
  }

  throw new Error(`Unsupported assistant tool: ${name}.`);
}

function tool(name: string, description: string): Responses.Tool {
  return { type: "function", name, description, strict: true, parameters: { type: "object", properties: {}, required: [], additionalProperties: false } };
}

function portfolioSummary(runtime: AssistantPortfolioRuntime) {
  return {
    baseCurrency: runtime.context.baseCurrency,
    valuation: runtime.context.valuation,
    allocation: runtime.context.allocation,
    strategyCompliance: runtime.context.strategyCompliance,
    holdings: runtime.context.holdings,
    accounts: runtime.context.accounts,
    marketData: runtime.context.marketData,
  };
}

function compactDailyBrief(model: Awaited<ReturnType<AssistantToolServices["getDailyBrief"]>>) {
  return {
    currency: model.currency,
    lastUpdated: model.lastUpdated,
    marketDataWarning: model.marketDataWarning,
    ...model.brief,
    dataQuality: {
      unavailableReason: model.brief.unavailableReason,
      isStale: model.brief.isStale,
      missingPriceSymbols: model.brief.missingPriceSymbols,
      riskState: model.brief.risk.state,
    },
  };
}

function compactPerformance(model: Awaited<ReturnType<AssistantToolServices["getPerformance"]>>) {
  return {
    status: model.summary.isPartial ? "PARTIAL" : "AVAILABLE",
    currency: model.currency,
    summary: model.summary,
    metrics: {
      twr: model.advanced.twr,
      xirr: model.advanced.xirr,
      ytdReturn: model.advanced.ytdReturn,
      oneYearReturn: model.advanced.oneYearReturn,
      maxDrawdown: model.advanced.maxDrawdown,
      periodPnl: model.advanced.periodPnl,
    },
    benchmark: {
      selectedAssetId: model.benchmark.selectedAssetId,
      selectedSymbol: model.benchmark.selectedSymbol,
      selectedName: model.benchmark.selectedName,
      ranges: Object.fromEntries(Object.entries(model.advanced.comparisons).map(([range, comparison]) => {
        const terminal = comparison.points.at(-1);
        return [range, {
          startDate: comparison.startDate,
          endDate: comparison.endDate,
          portfolioReturnPercent: terminal?.portfolioReturnPercent ?? null,
          benchmarkReturnPercent: terminal?.benchmarkReturnPercent ?? null,
          isPartial: comparison.isPartial,
          isStale: comparison.isStale,
          unavailableReason: comparison.unavailableReason,
        }];
      })),
    },
    dataQuality: {
      isPartial: model.summary.isPartial,
      isCostBasisPartial: model.summary.isCostBasisPartial,
      isExternalCashflowPartial: model.summary.isExternalCashflowPartial,
      missingPriceSymbols: model.summary.missingPriceSymbols,
      historicalMissingPriceSymbols: model.historicalMissingPriceSymbols,
      incompleteDates: model.incompleteDates,
      staleDates: model.staleDates,
    },
  };
}

function contributionOutput(projection: ContributionProjection, currency: string) {
  const isPartial = projection.plan.before.missingPriceSymbols.length > 0 || projection.plan.projectedAfter.missingPriceSymbols.length > 0;
  const missingPriceSymbols = [...new Set([...projection.plan.before.missingPriceSymbols, ...projection.plan.projectedAfter.missingPriceSymbols])].sort();
  return {
    status: isPartial ? "PARTIAL" : "AVAILABLE",
    currency,
    isCustomized: projection.isCustomized,
    contributionAmount: projection.plan.contributionAmount,
    allocations: projection.plan.allocations,
    assetRecommendations: projection.plan.assetRecommendations,
    before: projection.beforeComparison,
    projectedAfter: projection.afterComparison,
    skippedOrWarnings: projection.warnings,
    reasons: projection.reasons,
    dataQuality: {
      isPartial,
      missingPriceSymbols,
    },
  };
}

function scenarioOutput(scenario: PortfolioScenarioResult, accountName: string, runtime: AssistantPortfolioRuntime) {
  let alternative: ReturnType<typeof contributionOutput> | null = null;
  if (scenario.kind === "CONTRIBUTION" && scenario.remainingAmount && runtime.strategy) {
    try {
      alternative = contributionOutput(buildContributionProjection({
        portfolio: runtime.portfolio,
        assets: runtime.assets,
        strategy: runtime.strategy.allocations,
        contributionAmount: scenario.remainingAmount,
      }), runtime.strategy.baseCurrency);
    } catch {
      alternative = null;
    }
  }
  return {
    status: scenario.reasonCodes.includes("PARTIAL_VALUATION") ? "PARTIAL" : "AVAILABLE",
    kind: scenario.kind,
    symbol: scenario.symbol,
    accountName,
    amount: scenario.amount,
    quantity: scenario.quantity,
    sourceSymbol: scenario.sourceSymbol,
    sourceAccountId: scenario.sourceAccountId,
    sourceAccountName: scenario.sourceAccountId ? accountNameById(runtime, scenario.sourceAccountId) : null,
    sourceAmount: scenario.sourceAmount,
    sourceQuantity: scenario.sourceQuantity,
    destinationSymbol: scenario.destinationSymbol,
    destinationAccountId: scenario.destinationAccountId,
    destinationAccountName: scenario.destinationAccountId ? accountNameById(runtime, scenario.destinationAccountId) : null,
    destinationAmount: scenario.destinationAmount,
    destinationQuantity: scenario.destinationQuantity,
    fee: scenario.fee,
    currency: runtime.context.baseCurrency,
    currentPortfolioValue: scenario.current.totalValue,
    projectedPortfolioValue: scenario.projected.totalValue,
    allocationBefore: scenario.beforeComparison,
    allocationAfter: scenario.afterComparison,
    riskBefore: scenario.currentRisk,
    riskAfter: scenario.projectedRisk,
    warningsBefore: scenario.currentWarnings,
    warningsAfter: scenario.projectedWarnings,
    newWarnings: scenario.newWarnings,
    resolvedWarnings: scenario.resolvedWarnings,
    alternatives: scenario.maximumCompliantAmount === null ? null : {
      maximumAmountForRequestedAsset: scenario.maximumCompliantAmount,
      remainingAmount: scenario.remainingAmount,
      remainingContributionPlan: alternative,
      reasonCodes: ["COMPLIANT_AMOUNT_AVAILABLE", "CONTRIBUTION_FIRST"],
    },
    reasonCodes: scenario.reasonCodes,
    dataQuality: {
      isPartial: scenario.reasonCodes.includes("PARTIAL_VALUATION"),
      isStale: scenario.reasonCodes.includes("STALE_PRICE_DATA"),
      missingPriceSymbols: [...new Set([...scenario.current.missingPriceSymbols, ...scenario.projected.missingPriceSymbols])].sort(),
    },
  };
}

function resolveScenarioAccount(runtime: AssistantPortfolioRuntime, assetId: string, requestedName: string | null, kind: "BUY" | "EXTERNAL_BUY" | "SELL" | "CONTRIBUTION") {
  const candidates = runtime.accounts.map((account) => ({ id: account.id, name: account.name, type: account.type, custodian: account.custodian?.name ?? null }));
  if (requestedName) {
    const matches = candidates.filter((account) => account.name.toLocaleLowerCase() === requestedName.toLocaleLowerCase());
    return matches.length === 1 ? matches[0] : { reasonCode: matches.length === 0 ? "ACCOUNT_NOT_FOUND" : "ACCOUNT_REQUIRED", candidates };
  }
  if (kind !== "SELL") {
    return candidates.length === 1 ? candidates[0] : { reasonCode: "ACCOUNT_REQUIRED", candidates };
  }
  const holdingAccountIds = new Set(runtime.portfolio.holdings.filter((holding) => holding.assetId === assetId).map((holding) => holding.accountId));
  const holdingAccounts = candidates.filter((account) => holdingAccountIds.has(account.id));
  if (holdingAccounts.length === 1) return holdingAccounts[0];
  if (candidates.length === 1) return candidates[0];
  return { reasonCode: "ACCOUNT_REQUIRED", candidates };
}

function resolveTradeAccounts(
  runtime: AssistantPortfolioRuntime,
  sourceAssetId: string,
  sourceAccountName: string | null,
  destinationAccountName: string | null,
) {
  const candidates = runtime.accounts.map((account) => ({ id: account.id, name: account.name, type: account.type, custodian: account.custodian?.name ?? null }));
  const source = sourceAccountName
    ? resolveAccountByName(candidates, sourceAccountName, "SOURCE_ACCOUNT_REQUIRED")
    : resolveUniqueHoldingAccount(runtime, candidates, sourceAssetId, "SOURCE_ACCOUNT_REQUIRED");
  if ("reasonCode" in source) return source;

  const destination = destinationAccountName
    ? resolveAccountByName(candidates, destinationAccountName, "DESTINATION_ACCOUNT_REQUIRED")
    : source;
  if ("reasonCode" in destination) return destination;

  return { source, destination };
}

function resolveAccountByName(
  candidates: Array<{ id: string; name: string; type: string; custodian: string | null }>,
  requestedName: string,
  reasonCode: string,
) {
  const matches = candidates.filter((account) => account.name.toLocaleLowerCase() === requestedName.toLocaleLowerCase());
  return matches.length === 1 ? matches[0] : { reasonCode, candidates };
}

function resolveUniqueHoldingAccount(
  runtime: AssistantPortfolioRuntime,
  candidates: Array<{ id: string; name: string; type: string; custodian: string | null }>,
  assetId: string,
  reasonCode: string,
) {
  const holdingAccountIds = new Set(runtime.portfolio.holdings.filter((holding) => holding.assetId === assetId).map((holding) => holding.accountId));
  const holdingAccounts = candidates.filter((account) => holdingAccountIds.has(account.id));
  return holdingAccounts.length === 1 ? holdingAccounts[0] : { reasonCode, candidates };
}

function accountNameById(runtime: AssistantPortfolioRuntime, accountId: string) {
  return runtime.accounts.find((account) => account.id === accountId)?.name ?? null;
}

function engineAccounts(runtime: AssistantPortfolioRuntime) {
  return runtime.accounts.map((account) => ({
    id: account.id,
    name: account.name,
    type: account.type,
    custodian: account.custodian ? { id: account.custodian.id, name: account.custodian.name, category: account.custodian.category } : null,
  }));
}

function unavailable(reasonCode: string, details: Record<string, unknown> = {}) {
  return { status: "UNAVAILABLE", reasonCodes: [reasonCode], ...details };
}

function parseArguments(rawArguments: string) {
  try {
    const parsed: unknown = JSON.parse(rawArguments || "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
    return parsed;
  } catch {
    throw new Error("Assistant tool arguments were invalid JSON.");
  }
}
