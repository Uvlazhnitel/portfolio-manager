import { AccountType, AssetClass, AssetType, AssistantMessageRole, BasisMethod, Prisma, TransactionType, type CachedMarketPrice } from "@prisma/client";
import type OpenAI from "openai";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AssistantRepository } from "@/features/assistant/repository";
import { AssistantConversationService, buildConversationTitle } from "@/features/assistant/service";
import { loadAssistantPortfolioRuntime } from "@/features/assistant/context";
import { assistantToolDefinitions, executeAssistantTool } from "@/features/assistant/tools";
import { streamAssistantResponse } from "@/features/assistant/stream";
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
    await service.saveAssistantMessage(prepared.conversationId, "It would change crypto allocation.");
    const messages = await service.listRecentMessages(prepared.conversationId);

    expect(messages.map((message) => message.role)).toEqual([AssistantMessageRole.USER, AssistantMessageRole.ASSISTANT]);
    expect(messages.map((message) => message.content)).toEqual(["What happens if I buy BTC?", "It would change crypto allocation."]);
    expect((await repository.findConversation(prepared.conversationId))?.title).toBe("What happens if I buy BTC?");

    const beforeRetry = await testDb.prisma.assistantMessage.count({ where: { conversationId: prepared.conversationId } });
    await service.prepareUserMessage({ conversationId: prepared.conversationId, message: "New unanswered question" });
    await service.prepareUserMessage({ conversationId: prepared.conversationId, message: "New unanswered question" });
    expect(await testDb.prisma.assistantMessage.count({ where: { conversationId: prepared.conversationId } })).toBe(beforeRetry + 1);
  });

  it("uses a compact deterministic title and rejects unknown conversations", async () => {
    expect(buildConversationTitle("x".repeat(80))).toHaveLength(58);
    await expect(new AssistantConversationService(new AssistantRepository(testDb.prisma)).prepareUserMessage({ conversationId: "missing", message: "Hello" })).rejects.toThrow("not found");
  });

  it("deletes owned messages when a conversation is removed", async () => {
    const conversation = await testDb.prisma.assistantConversation.create({
      data: { title: "Disposable", messages: { create: { role: AssistantMessageRole.USER, content: "Hello" } } },
    });
    await testDb.prisma.assistantConversation.delete({ where: { id: conversation.id } });
    expect(await testDb.prisma.assistantMessage.count({ where: { conversationId: conversation.id } })).toBe(0);
  });
});

describe("assistant portfolio context and tools", () => {
  it("builds compact Decimal-safe context without transaction notes", () => {
    expect(runtime.context.valuation).toEqual(expect.objectContaining({ totalPortfolioValue: "1000.00", isPartial: false, priceCoveragePercent: "100.00" }));
    expect(runtime.context.holdings).toEqual(expect.arrayContaining([expect.objectContaining({ symbol: "BTC", quantity: "1", currentValue: "100.00" })]));
    expect(runtime.context.latestContributionRecommendation?.contributionAmount).toBe("1000.00");
    expect(JSON.stringify(runtime.context)).not.toContain("DO_NOT_SEND_THIS_NOTE");
  });

  it("returns deterministic summary, strategy, contribution plan, and BTC simulation", async () => {
    const transactionCount = await testDb.prisma.transaction.count();
    const summary = await executeAssistantTool("get_portfolio_summary", "{}", runtime) as { valuation: { totalPortfolioValue: string } };
    const savedStrategy = await executeAssistantTool("get_strategy", "{}", runtime) as { allocations: unknown[] };
    const plan = await executeAssistantTool("plan_contribution", JSON.stringify({ amount: "1000" }), runtime) as { currency: string; allocations: Array<{ amount: string }>; assetRecommendations: Array<{ symbol: string }> };
    const simulation = await executeAssistantTool("simulate_transaction", JSON.stringify({ symbol: "btc", type: "BUY", amount: "500" }), runtime) as { projectedAssetClassPercent: string; strategyMaximum: string; violations: Array<{ code: string }> };

    expect(summary.valuation.totalPortfolioValue).toBe("1000.00");
    expect(savedStrategy.allocations).toHaveLength(4);
    expect(plan.allocations.reduce((sum, allocation) => sum + Number(allocation.amount), 0)).toBe(1000);
    expect(plan.assetRecommendations.map((item) => item.symbol)).toContain("BTC");
    expect(plan.currency).toBe(runtime.strategy?.baseCurrency);
    expect(JSON.stringify(assistantToolDefinitions.find((tool) => "name" in tool && tool.name === "plan_contribution"))).not.toContain('"currency"');
    expect(simulation).toEqual(expect.objectContaining({ projectedAssetClassPercent: "40.00", strategyMaximum: "20.00" }));
    expect(simulation.violations).toContainEqual(expect.objectContaining({ code: "CRYPTO_ABOVE_MAX" }));
    expect(await testDb.prisma.transaction.count()).toBe(transactionCount);
  });

  it("rejects unknown assets, invalid amounts, and oversells", async () => {
    await expect(executeAssistantTool("simulate_transaction", JSON.stringify({ symbol: "DOGE", type: "BUY", amount: "10" }), runtime)).rejects.toThrow("not found");
    await expect(executeAssistantTool("simulate_transaction", JSON.stringify({ symbol: "BTC", type: "BUY", amount: "NaN" }), runtime)).rejects.toThrow();
    await expect(executeAssistantTool("simulate_transaction", JSON.stringify({ symbol: "BTC", type: "SELL", amount: "100.01" }), runtime)).rejects.toThrow("exceeds");
    const partialPrices = Object.fromEntries(Object.entries(runtime.marketPrices).filter(([symbol]) => symbol !== "BTC"));
    await expect(executeAssistantTool("simulate_transaction", JSON.stringify({ symbol: "BTC", type: "BUY", amount: "10" }), { ...runtime, marketPrices: partialPrices })).rejects.toThrow("price is unavailable");
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
    expect(emitted).toContainEqual({ type: "tool", name: "simulate_transaction" });
    expect(calls[0].model).toBe("gpt-5-mini");
    const secondInput = calls[1].input as Array<Record<string, unknown>>;
    expect(secondInput).toContainEqual(expect.objectContaining({ type: "function_call_output", call_id: "call-btc" }));
  });

  it("surfaces a failed OpenAI stream without inventing output", async () => {
    const fakeClient = { responses: { create: async () => events([{ type: "response.failed" }]) } } as unknown as OpenAI;
    await expect(streamAssistantResponse({ client: fakeClient, model: "gpt-5-mini", runtime, history: [], onEvent: () => undefined }))
      .rejects.toThrow("could not complete");
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
      name: "simulate_transaction",
      arguments: JSON.stringify({ symbol: "BTC", type: "BUY", amount: "500" }),
      status: "completed",
    }],
  };
}
