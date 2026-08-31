import { AccountType, AssetClass, AssetType, AssistantMessageRole, AssistantMessageStatus, BasisMethod, Prisma, TransactionType, type CachedMarketPrice } from "@prisma/client";
import type OpenAI from "openai";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AssistantRepository } from "@/features/assistant/repository";
import { AssistantConversationService, buildConversationTitle } from "@/features/assistant/service";
import { loadAssistantPortfolioRuntime } from "@/features/assistant/context";
import { ASSISTANT_SYSTEM_INSTRUCTIONS } from "@/features/assistant/instructions";
import { assistantToolDefinitions, executeAssistantTool } from "@/features/assistant/tools";
import type { AssistantToolServices } from "@/features/assistant/tool-services";
import { AssistantStreamError, streamAssistantResponse } from "@/features/assistant/stream";
import { ContributionPlanRepository } from "@/features/contributions/repository";
import { MarketDataService } from "@/features/market-data/service";
import type { MarketDataStore } from "@/features/market-data/repository";
import { PortfolioRepository } from "@/features/portfolio/repository";
import { StrategyRepository } from "@/features/strategy/repository";
import { createTestDatabase, type TestDatabase } from "../helpers/test-db";

let testDb: TestDatabase;
let runtime: Awaited<ReturnType<typeof loadAssistantPortfolioRuntime>>;

beforeAll(async () => {
  testDb = await createTestDatabase();
  const account = await testDb.prisma.account.create({ data: { name: "Main broker", type: AccountType.BROKER } });
  const [etf, btc, eur, xaut] = await Promise.all([
    testDb.prisma.asset.create({ data: { symbol: "VWCE", name: "Global ETF", assetClass: AssetClass.ETF, assetType: AssetType.ETF, currency: "EUR" } }),
    testDb.prisma.asset.create({ data: { symbol: "BTC", name: "Bitcoin", assetClass: AssetClass.CRYPTO, assetType: AssetType.CRYPTO, currency: "BTC" } }),
    testDb.prisma.asset.create({ data: { symbol: "EUR", name: "Euro", assetClass: AssetClass.CASH, assetType: AssetType.FIAT, currency: "EUR" } }),
    testDb.prisma.asset.create({ data: { symbol: "XAUT", name: "Tether Gold", assetClass: AssetClass.GOLD, assetType: AssetType.TOKENIZED_GOLD, currency: "XAUT" } }),
  ]);
  await testDb.prisma.transaction.createMany({ data: [
    { accountId: account.id, assetId: etf.id, type: TransactionType.INITIAL_BALANCE, basisMethod: BasisMethod.KNOWN_COST, quantity: "80", pricePerUnit: "8", currency: "EUR", executedAt: new Date("2026-08-01"), note: "DO_NOT_SEND_THIS_NOTE" },
    { accountId: account.id, assetId: btc.id, type: TransactionType.INITIAL_BALANCE, basisMethod: BasisMethod.KNOWN_COST, quantity: "1", pricePerUnit: "75", currency: "EUR", executedAt: new Date("2026-08-02") },
    { accountId: account.id, assetId: eur.id, type: TransactionType.INITIAL_BALANCE, basisMethod: BasisMethod.KNOWN_COST, quantity: "100", pricePerUnit: "1", currency: "EUR", executedAt: new Date("2026-08-03") },
  ] });
  const strategy = await testDb.prisma.strategy.create({
    data: {
      name: "Long-term capital growth", objective: "Grow capital consistently", baseCurrency: "EUR",
      allocations: { create: [
        { assetClass: AssetClass.ETF, targetPercent: "70", minPercent: "60", maxPercent: "80", assetAllocations: { create: [{ assetId: etf.id, targetPercent: "100" }] } },
        { assetClass: AssetClass.CRYPTO, targetPercent: "15", minPercent: "10", maxPercent: "20", assetAllocations: { create: [{ assetId: btc.id, targetPercent: "100" }] } },
        { assetClass: AssetClass.GOLD, targetPercent: "10", minPercent: "5", maxPercent: "15", assetAllocations: { create: [{ assetId: xaut.id, targetPercent: "100" }] } },
        { assetClass: AssetClass.CASH, targetPercent: "5", minPercent: "0", maxPercent: "10", assetAllocations: { create: [{ assetId: eur.id, targetPercent: "100" }] } },
      ] },
    },
  });
  await testDb.prisma.contributionPlan.create({ data: { strategyId: strategy.id, contributionAmount: "1000", currency: "EUR", allocations: [], isCustomized: false } });
  const now = new Date("2026-08-25T10:00:00Z");
  const prices: CachedMarketPrice[] = [
    price("etf-price", etf.id, "10", now), price("btc-price", btc.id, "100", now), price("eur-price", eur.id, "1", now),
  ];
  runtime = await loadAssistantPortfolioRuntime({
    portfolioRepository: new PortfolioRepository(testDb.prisma),
    strategyRepository: new StrategyRepository(testDb.prisma),
    contributionPlanRepository: new ContributionPlanRepository(testDb.prisma),
    marketDataService: new MarketDataService(new PriceStore(prices), []),
  });
});

afterAll(async () => testDb.cleanup());

describe("assistant persistence", () => {
  it("creates a titled conversation and stores ordered user/assistant messages", async () => {
    const repository = new AssistantRepository(testDb.prisma);
    const service = new AssistantConversationService(repository);
    const prepared = await service.prepareUserMessage({ message: "  What happens if I buy BTC?  " });
    expect((await repository.findMessage(prepared.userMessageId))?.status).toBe(AssistantMessageStatus.PENDING);
    expect(await service.listRecentMessages(prepared.conversationId)).toEqual([]);

    await service.completeTurn(prepared.conversationId, prepared.userMessageId, "It would change crypto allocation.");
    const messages = await service.listRecentMessages(prepared.conversationId);

    expect(messages.map((message) => message.role)).toEqual([AssistantMessageRole.USER, AssistantMessageRole.ASSISTANT]);
    expect(messages.every((message) => message.status === AssistantMessageStatus.COMPLETED)).toBe(true);
    expect(messages.map((message) => message.content)).toEqual(["What happens if I buy BTC?", "It would change crypto allocation."]);
    expect((await repository.findConversation(prepared.conversationId))?.title).toBe("What happens if I buy BTC?");
  });

  it("marks failed turns, excludes them from model history, and retries without duplication", async () => {
    const repository = new AssistantRepository(testDb.prisma);
    const service = new AssistantConversationService(repository);
    const first = await service.prepareUserMessage({ message: "Explain my risk" });
    await service.failTurn(first.userMessageId);
    expect(await service.listRecentMessages(first.conversationId)).toEqual([]);
    expect((await repository.findConversation(first.conversationId))?.messages).toContainEqual(
      expect.objectContaining({ id: first.userMessageId, status: AssistantMessageStatus.FAILED }),
    );

    const beforeRetry = await testDb.prisma.assistantMessage.count({ where: { conversationId: first.conversationId } });
    const retried = await service.prepareUserMessage({
      conversationId: first.conversationId,
      retryMessageId: first.userMessageId,
      message: "Explain my risk",
    });
    expect(retried.userMessageId).toBe(first.userMessageId);
    expect(await testDb.prisma.assistantMessage.count({ where: { conversationId: first.conversationId } })).toBe(beforeRetry);

    await service.completeTurn(retried.conversationId, retried.userMessageId, "Risk is within the configured limits.");
    expect((await service.listRecentMessages(first.conversationId)).map((message) => message.role)).toEqual([
      AssistantMessageRole.USER,
      AssistantMessageRole.ASSISTANT,
    ]);
  });

  it("allows an interrupted pending message to retry after five minutes", async () => {
    const repository = new AssistantRepository(testDb.prisma);
    const service = new AssistantConversationService(repository);
    const prepared = await service.prepareUserMessage({ message: "Interrupted request" });
    await testDb.prisma.assistantMessage.update({
      where: { id: prepared.userMessageId },
      data: { createdAt: new Date(Date.now() - 6 * 60 * 1000) },
    });

    const retried = await service.prepareUserMessage({
      conversationId: prepared.conversationId,
      retryMessageId: prepared.userMessageId,
      message: prepared.message,
    });
    expect(retried.userMessageId).toBe(prepared.userMessageId);
    expect((await repository.findMessage(prepared.userMessageId))?.status).toBe(AssistantMessageStatus.PENDING);
  });

  it("uses a compact deterministic title and rejects unknown conversations", async () => {
    expect(buildConversationTitle("x".repeat(80))).toHaveLength(58);
    await expect(new AssistantConversationService(new AssistantRepository(testDb.prisma)).prepareUserMessage({ conversationId: "missing", message: "Hello" })).rejects.toThrow("not found");
  });

  it("deletes a conversation and its owned messages", async () => {
    const conversation = await testDb.prisma.assistantConversation.create({
      data: { title: "Disposable", messages: { create: { role: AssistantMessageRole.USER, content: "Hello" } } },
    });
    await new AssistantConversationService(new AssistantRepository(testDb.prisma)).deleteConversation(conversation.id);
    expect(await testDb.prisma.assistantConversation.findUnique({ where: { id: conversation.id } })).toBeNull();
    expect(await testDb.prisma.assistantMessage.count({ where: { conversationId: conversation.id } })).toBe(0);
  });
});

describe("assistant portfolio context and tools", () => {
  it("exposes authoritative v2 tools and retires duplicate calculation tools", () => {
    const names = assistantToolDefinitions.flatMap((tool) => "name" in tool ? [tool.name] : []);
    expect(names).toEqual(expect.arrayContaining([
      "get_daily_brief",
      "get_risk_snapshot",
      "simulate_scenario",
      "get_performance_summary",
      "explain_contribution_plan",
    ]));
    expect(names).not.toEqual(expect.arrayContaining(["simulate_transaction", "plan_contribution"]));
    expect(ASSISTANT_SYSTEM_INSTRUCTIONS).toContain("For what changed since the previous observation, call get_daily_brief");
    expect(ASSISTANT_SYSTEM_INSTRUCTIONS).toContain("Never calculate allocation, value, drift, P&L, TWR, XIRR, risk");
    expect(ASSISTANT_SYSTEM_INSTRUCTIONS).toContain("Never execute trades, create transactions, persist scenarios");
  });

  it("builds compact Decimal-safe context without transaction notes", () => {
    expect(runtime.context.valuation).toEqual(expect.objectContaining({ totalPortfolioValue: "1000.00", isPartial: false, priceCoveragePercent: "100.00" }));
    expect(runtime.context.holdings).toEqual(expect.arrayContaining([expect.objectContaining({ symbol: "BTC", quantity: "1", currentValue: "100.00" })]));
    expect(runtime.context.latestContributionRecommendation?.contributionAmount).toBe("1000.00");
    expect(runtime.context.risk).toEqual(expect.objectContaining({ state: "PARTIAL", largestAsset: expect.objectContaining({ subjectName: "VWCE", valuePercent: "80.00" }), largestCustodian: expect.objectContaining({ state: "PARTIAL", valuePercent: null }) }));
    expect(JSON.stringify(runtime.context)).not.toContain("DO_NOT_SEND_THIS_NOTE");
  });

  it("returns deterministic summary, strategy, contribution plan, and BTC scenario", async () => {
    const transactionCount = await testDb.prisma.transaction.count();
    const summary = await executeAssistantTool("get_portfolio_summary", "{}", runtime) as { valuation: { totalPortfolioValue: string } };
    const savedStrategy = await executeAssistantTool("get_strategy", "{}", runtime) as { allocations: unknown[] };
    const plan = await executeAssistantTool("explain_contribution_plan", JSON.stringify({ amount: "1000" }), runtime) as { currency: string; allocations: Array<{ amount: string }>; assetRecommendations: Array<{ symbol: string }> };
    const simulation = await executeAssistantTool("simulate_scenario", JSON.stringify({ symbol: "btc", kind: "BUY", amount: "500", accountName: null }), runtime) as unknown as { allocationAfter: Array<{ assetClass: string; currentPercent: string }>; newWarnings: Array<{ code: string }>; alternatives: { maximumAmountForRequestedAsset: string } };

    expect(summary.valuation.totalPortfolioValue).toBe("1000.00");
    expect(savedStrategy.allocations).toHaveLength(4);
    expect(plan.allocations.reduce((sum, allocation) => sum + Number(allocation.amount), 0)).toBe(1000);
    expect(plan.assetRecommendations.map((item) => item.symbol)).toContain("BTC");
    expect(plan.currency).toBe(runtime.strategy?.baseCurrency);
    expect(JSON.stringify(assistantToolDefinitions.find((tool) => "name" in tool && tool.name === "explain_contribution_plan"))).not.toContain('"currency"');
    expect(simulation.allocationAfter).toContainEqual(expect.objectContaining({ assetClass: "CRYPTO", currentPercent: "40.00" }));
    expect(simulation.newWarnings).toContainEqual(expect.objectContaining({ code: "CRYPTO_ABOVE_MAX" }));
    expect(simulation.alternatives.maximumAmountForRequestedAsset).toBe("125.00");
    expect(await testDb.prisma.transaction.count()).toBe(transactionCount);
  });

  it("returns structured unavailable states and rejects invalid amounts and account oversells", async () => {
    const unknown = await executeAssistantTool("simulate_scenario", JSON.stringify({ symbol: "DOGE", kind: "BUY", amount: "10", accountName: null }), runtime) as { status: string; reasonCodes: string[] };
    expect(unknown).toEqual(expect.objectContaining({ status: "UNAVAILABLE", reasonCodes: ["ASSET_NOT_FOUND"] }));
    await expect(executeAssistantTool("simulate_scenario", JSON.stringify({ symbol: "BTC", kind: "BUY", amount: "NaN", accountName: null }), runtime)).rejects.toThrow();
    const oversell = await executeAssistantTool("simulate_scenario", JSON.stringify({ symbol: "BTC", kind: "SELL", amount: "100.01", accountName: "Main broker" }), runtime) as { status: string; reasonCodes: string[] };
    expect(oversell).toEqual(expect.objectContaining({ status: "UNAVAILABLE", reasonCodes: ["INSUFFICIENT_ACCOUNT_HOLDING"] }));
    const partialPrices = Object.fromEntries(Object.entries(runtime.marketPrices).filter(([symbol]) => symbol !== "BTC"));
    const missingPrice = await executeAssistantTool("simulate_scenario", JSON.stringify({ symbol: "BTC", kind: "BUY", amount: "10", accountName: null }), { ...runtime, marketPrices: partialPrices }) as { status: string; reasonCodes: string[] };
    expect(missingPrice).toEqual(expect.objectContaining({ status: "UNAVAILABLE", reasonCodes: ["MISSING_MARKET_PRICE"] }));
  });

  it("returns account candidates instead of guessing and supports safe scenarios", async () => {
    const ambiguousRuntime = {
      ...runtime,
      accounts: [...runtime.accounts, { ...runtime.accounts[0], id: "other-account", name: "Other broker" }],
    };
    const ambiguous = await executeAssistantTool("simulate_scenario", JSON.stringify({ symbol: "XAUT", kind: "CONTRIBUTION", amount: "10", accountName: null }), ambiguousRuntime) as { status: string; reasonCodes: string[]; accounts: Array<{ name: string }> };
    const safe = await executeAssistantTool("simulate_scenario", JSON.stringify({ symbol: "BTC", kind: "BUY", amount: "10", accountName: null }), runtime) as unknown as { newWarnings: unknown[]; alternatives: unknown };

    expect(ambiguous.status).toBe("UNAVAILABLE");
    expect(ambiguous.reasonCodes).toContain("ACCOUNT_REQUIRED");
    expect(ambiguous.accounts.map((account) => account.name)).toEqual(["Main broker", "Other broker"]);
    expect(safe.newWarnings).toEqual([]);
    expect(safe.alternatives).toBeNull();
  });

  it("explains saved and class-only contribution plans without inventing asset targets", async () => {
    const saved = await executeAssistantTool("explain_contribution_plan", JSON.stringify({ amount: null }), runtime) as { status: string; contributionAmount: string };
    const noSaved = await executeAssistantTool("explain_contribution_plan", JSON.stringify({ amount: null }), { ...runtime, context: { ...runtime.context, latestContributionRecommendation: null } }) as { status: string; reasonCodes: string[] };
    const classOnlyRuntime = {
      ...runtime,
      strategy: runtime.strategy ? {
        ...runtime.strategy,
        allocations: runtime.strategy.allocations.map((allocation) => ({ ...allocation, assetAllocations: [] })),
      } : null,
    };
    const classOnly = await executeAssistantTool("explain_contribution_plan", JSON.stringify({ amount: "100" }), classOnlyRuntime) as unknown as { allocations: unknown[]; assetRecommendations: unknown[] };

    expect(saved).toEqual(expect.objectContaining({ status: "AVAILABLE", contributionAmount: "1000.00" }));
    expect(noSaved).toEqual(expect.objectContaining({ status: "UNAVAILABLE", reasonCodes: ["CONTRIBUTION_PLAN_NOT_CONFIGURED"] }));
    expect(classOnly.allocations.length).toBeGreaterThan(0);
    expect(classOnly.assetRecommendations).toEqual([]);
  });

  it("passes Daily Brief, Risk, Performance, partial, and stale states through authoritative tools", async () => {
    const services = deterministicToolServices();
    const daily = await executeAssistantTool("get_daily_brief", "{}", runtime, services) as unknown as { status: string; dailyGain: string; reasonCodes: string[]; dataQuality: { isStale: boolean } };
    const risk = await executeAssistantTool("get_risk_snapshot", "{}", runtime, services) as unknown as { risk: { state: string }; dataQuality: { state: string } };
    const performance = await executeAssistantTool("get_performance_summary", "{}", runtime, services) as unknown as { metrics: { xirr: { unavailableReason: string } }; dataQuality: { isPartial: boolean; staleDates: number } };

    expect(daily).toEqual(expect.objectContaining({ status: "NO_ACTION", dailyGain: "12.34", reasonCodes: ["NO_MEANINGFUL_STRATEGY_CHANGE"] }));
    expect(daily.dataQuality.isStale).toBe(true);
    expect(risk.risk).toBe(runtime.context.risk);
    expect(risk.dataQuality.state).toBe("PARTIAL");
    expect(performance.metrics.xirr.unavailableReason).toBe("XIRR_PERIOD_TOO_SHORT");
    expect(performance.dataQuality).toEqual(expect.objectContaining({ isPartial: true, staleDates: 1 }));
  });
});

describe("assistant OpenAI orchestration", () => {
  it("replays the function call with its call_id and streams the final explanation", async () => {
    const calls: Array<Record<string, unknown>> = [];
    const fakeClient = {
      responses: {
        create: async (input: Record<string, unknown>) => {
          calls.push(input);
          return calls.length === 1
            ? events([{ type: "response.completed", response: responseWithToolCall() }])
            : events([
                { type: "response.output_text.delta", delta: "BTC would exceed your range." },
                { type: "response.completed", response: { output: [] } },
              ]);
        },
      },
    } as unknown as OpenAI;
    const emitted: unknown[] = [];
    const text = await streamAssistantResponse({
      client: fakeClient,
      model: "gpt-5-mini",
      runtime,
      history: [{ role: "USER", content: "Should I buy €500 of BTC?" }],
      onEvent: (event) => { emitted.push(event); },
    });

    expect(text).toBe("BTC would exceed your range.");
    expect(emitted).toContainEqual({ type: "tool", name: "simulate_scenario" });
    expect(calls[0].model).toBe("gpt-5-mini");
    expect(calls[0].reasoning).toEqual({ effort: "low" });
    expect(calls[0].text).toEqual({ verbosity: "low" });
    expect(calls[0].max_output_tokens).toBe(3000);
    expect(JSON.stringify(calls[0].input)).not.toContain("totalPortfolioValue");
    const secondInput = calls[1].input as Array<Record<string, unknown>>;
    expect(secondInput).toContainEqual(expect.objectContaining({ type: "function_call_output", call_id: "call-btc" }));
  });

  it("surfaces a failed OpenAI stream without inventing output", async () => {
    const fakeClient = { responses: { create: async () => events([{ type: "response.failed" }]) } } as unknown as OpenAI;
    await expect(streamAssistantResponse({ client: fakeClient, model: "gpt-5-mini", runtime, history: [], onEvent: () => undefined }))
      .rejects.toThrow("could not complete");
  });

  it("returns a typed max-output error for incomplete responses", async () => {
    const fakeClient = {
      responses: {
        create: async () => events([{
          type: "response.incomplete",
          response: { incomplete_details: { reason: "max_output_tokens" } },
        }]),
      },
    } as unknown as OpenAI;
    const result = streamAssistantResponse({ client: fakeClient, model: "gpt-5-mini", runtime, history: [], onEvent: () => undefined });
    await expect(result).rejects.toMatchObject({ code: "MAX_OUTPUT_TOKENS" } satisfies Partial<AssistantStreamError>);
  });
});

function price(id: string, assetId: string, value: string, now: Date): CachedMarketPrice {
  return { id, assetId, currency: "EUR", price: new Prisma.Decimal(value), timestamp: now, fetchedAt: now, source: "TEST", createdAt: now, updatedAt: now };
}

class PriceStore implements MarketDataStore {
  constructor(private readonly prices: CachedMarketPrice[]) {}
  async listCachedPrices(assetIds: string[], currency: string) { return this.prices.filter((item) => assetIds.includes(item.assetId) && item.currency === currency); }
  async listManualPrices() { return []; }
  async saveCachedPrices() {}
}

function events(items: unknown[]) {
  return { async *[Symbol.asyncIterator]() { for (const item of items) yield item; } };
}

function responseWithToolCall() {
  return {
    output: [{
      type: "function_call",
      id: "fc-btc",
      call_id: "call-btc",
      name: "simulate_scenario",
      arguments: JSON.stringify({ symbol: "BTC", kind: "BUY", amount: "500", accountName: null }),
      status: "completed",
    }],
  };
}

function deterministicToolServices(): AssistantToolServices {
  const metric = (value: string | null, unavailableReason: string | null = null) => ({ value, startDate: "2026-08-01", endDate: "2026-08-02", isStale: true, unavailableReason });
  const comparison = { points: [], startDate: null, endDate: null, isPartial: true, isStale: true, unavailableReason: "MISSING_BENCHMARK_PRICES" };
  return {
    getDailyBrief: async () => ({
      currency: "EUR",
      lastUpdated: "2026-08-02T12:00:00.000Z",
      marketDataWarning: "Stale prices present.",
      brief: {
        status: "NO_ACTION",
        summary: "No meaningful strategy change.",
        reasonCodes: ["NO_MEANINGFUL_STRATEGY_CHANGE"],
        currentDate: "2026-08-02",
        previousDate: "2026-08-01",
        currentValue: "1012.34",
        previousValue: "1000.00",
        portfolioValueChange: "12.34",
        dailyGain: "12.34",
        dailyReturnPercent: "1.23",
        externalContributions: "0.00",
        externalWithdrawals: "0.00",
        unavailableReason: null,
        isStale: true,
        missingPriceSymbols: [],
        positiveContributors: [],
        negativeContributors: [],
        allocationChanges: [],
        newViolations: [],
        resolvedViolations: [],
        currentViolations: [],
        risk: runtime.context.risk,
      },
    }),
    getPerformance: async () => ({
      currency: "EUR",
      summary: {
        portfolioValue: "1000.00", netInvested: "700.00", investmentGain: null, trackedCapital: "900.00", trackedCapitalReturnPercent: null,
        netContributed: "0.00", externalContributions: "0.00", externalWithdrawals: "0.00", openingBasis: "200.00", giftTrackingBasis: "0.00", internalTradeFees: "0.00",
        isNetInvestedPartial: false, missingNetInvestedSymbols: [], coveredSymbols: ["BTC"], openingBasisUnknownSymbols: [], performanceExclusions: [], isCostBasisPartial: true,
        missingCostBasisSymbols: ["XAUT"], isExternalCashflowPartial: false, missingExternalCashflowSymbols: [], isPartial: true, missingPriceSymbols: ["XAUT"], hasStalePrices: true,
      },
      history: [],
      advanced: {
        twr: metric("1.00"),
        xirr: metric(null, "XIRR_PERIOD_TOO_SHORT"),
        ytdReturn: metric(null, "INSUFFICIENT_HISTORY"),
        oneYearReturn: metric(null, "INSUFFICIENT_HISTORY"),
        maxDrawdown: metric("-1.00"),
        comparisons: { "7D": comparison, "1M": comparison, "3M": comparison, "1Y": comparison, ALL: comparison },
      },
      benchmark: { strategyId: null, selectedAssetId: null, selectedSymbol: null, selectedName: null, options: [] },
      trackingStartedAt: null,
      incompleteDates: 1,
      staleDates: 1,
      historicalMissingPriceSymbols: ["XAUT"],
      historicalMissingCostBasisSymbols: ["XAUT"],
    }),
  } as unknown as AssistantToolServices;
}
