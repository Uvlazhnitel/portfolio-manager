import type { Responses } from "openai/resources/responses/responses";
import { buildContributionProjection } from "@/features/portfolio-engine";
import type { AssistantPortfolioRuntime } from "@/features/assistant/context";
import { checkAssistantTransaction } from "@/features/assistant/transaction-check";
import { planContributionToolSchema, simulateTransactionToolSchema } from "@/features/assistant/validation";

export const assistantToolDefinitions: Responses.Tool[] = [
  {
    type: "function",
    name: "get_portfolio_summary",
    description: "Return deterministic current portfolio value, allocation, price coverage, and strategy violations. Use this for any question about the current portfolio.",
    strict: true,
    parameters: { type: "object", properties: {}, required: [], additionalProperties: false },
  },
  {
    type: "function",
    name: "get_strategy",
    description: "Return the user's saved long-term strategy, allocation targets, ranges, and portfolio rules.",
    strict: true,
    parameters: { type: "object", properties: {}, required: [], additionalProperties: false },
  },
  {
    type: "function",
    name: "plan_contribution",
    description: "Use the deterministic contribution planner to allocate a new contribution in the portfolio's trusted base currency without selling existing assets.",
    strict: true,
    parameters: {
      type: "object",
      properties: {
        amount: { type: "string", description: "Positive amount with at most two decimal places." },
      },
      required: ["amount"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "simulate_transaction",
    description: "Simulate a BUY or SELL as an external cashflow in the portfolio's trusted base currency without changing real data. Always use this before discussing the allocation effect of a proposed transaction.",
    strict: true,
    parameters: {
      type: "object",
      properties: {
        symbol: { type: "string", description: "Existing portfolio asset symbol, for example BTC." },
        type: { type: "string", enum: ["BUY", "SELL"] },
        amount: { type: "string", description: "Positive amount with at most two decimal places." },
      },
      required: ["symbol", "type", "amount"],
      additionalProperties: false,
    },
  },
];

export async function executeAssistantTool(
  name: string,
  rawArguments: string,
  runtime: AssistantPortfolioRuntime,
) {
  const argumentsValue = parseArguments(rawArguments);

  if (name === "get_portfolio_summary") {
    return {
      baseCurrency: runtime.context.baseCurrency,
      valuation: runtime.context.valuation,
      allocation: runtime.context.allocation,
      violations: runtime.context.violations,
      holdings: runtime.context.holdings,
      accounts: runtime.context.accounts,
      marketData: runtime.context.marketData,
    };
  }

  if (name === "get_strategy") {
    return {
      baseCurrency: runtime.context.baseCurrency,
      strategy: runtime.context.strategy,
      allocations: runtime.context.strategy?.allocations ?? [],
    };
  }

  if (name === "plan_contribution") {
    const parsed = planContributionToolSchema.parse(argumentsValue);
    if (!runtime.strategy) throw new Error("Active strategy was not found.");
    const projection = buildContributionProjection({
      portfolio: runtime.portfolio,
      assets: runtime.assets,
      strategy: runtime.strategy.allocations,
      contributionAmount: parsed.amount,
    });
    return {
      contributionAmount: projection.plan.contributionAmount,
      currency: runtime.strategy.baseCurrency,
      allocations: projection.plan.allocations,
      assetRecommendations: projection.plan.assetRecommendations,
      before: projection.beforeComparison,
      projectedAfter: projection.afterComparison,
      warnings: projection.warnings,
      reasons: projection.reasons,
    };
  }

  if (name === "simulate_transaction") {
    const parsed = simulateTransactionToolSchema.parse(argumentsValue);
    if (!runtime.strategy) throw new Error("Active strategy was not found.");
    const asset = runtime.assets.find((candidate) => candidate.symbol.toUpperCase() === parsed.symbol);
    if (!asset) throw new Error(`Asset ${parsed.symbol} was not found.`);
    const simulation = checkAssistantTransaction({
      assets: runtime.assets,
      transactions: runtime.transactions,
      marketPrices: runtime.marketPrices,
      strategy: runtime.strategy.allocations,
      baseCurrency: runtime.strategy.baseCurrency,
      assetId: asset.id,
      type: parsed.type,
      amount: parsed.amount,
    });
    const before = simulation.beforeComparison.find((item) => item.assetClass === asset.assetClass);
    const after = simulation.afterComparison.find((item) => item.assetClass === asset.assetClass);
    return {
      symbol: asset.symbol,
      assetClass: asset.assetClass,
      transactionType: parsed.type,
      amount: simulation.amount,
      currency: runtime.strategy.baseCurrency,
      currentPortfolioValue: simulation.current.totalValue,
      projectedPortfolioValue: simulation.projected.totalValue,
      currentAssetClassPercent: before?.currentPercent ?? "0.00",
      projectedAssetClassPercent: after?.currentPercent ?? "0.00",
      strategyTarget: after?.targetPercent ?? null,
      strategyMinimum: after?.minPercent ?? null,
      strategyMaximum: after?.maxPercent ?? null,
      projectedStatus: after?.status ?? null,
      violations: simulation.warnings,
      isPartial: simulation.reasonCodes.includes("PARTIAL_VALUATION"),
      missingPriceSymbols: simulation.projected.missingPriceSymbols,
    };
  }

  throw new Error(`Unsupported assistant tool: ${name}.`);
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
