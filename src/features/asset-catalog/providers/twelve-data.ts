import "server-only";

import { z } from "zod";
import { resolveTwelveDataApiKey } from "@/features/integrations/service";
import type { AssetCatalogProvider, AssetCatalogResult } from "@/features/asset-catalog/types";

const responseSchema = z.object({
  data: z.array(z.object({
    symbol: z.string().min(1),
    instrument_name: z.string().min(1),
    exchange: z.string().min(1),
    mic_code: z.string().min(1),
    instrument_type: z.string().min(1),
    country: z.string().min(1).nullable().optional(),
    currency: z.string().length(3),
    access: z.object({
      global: z.string().nullable().optional(),
      plan: z.string().nullable().optional(),
    }).nullable().optional(),
  })),
  status: z.literal("ok"),
});

const apiErrorSchema = z.object({ status: z.literal("error") });
type FetchLike = typeof fetch;
type ApiKeyResolver = () => Promise<string | undefined>;

export class TwelveDataAssetCatalogProvider implements AssetCatalogProvider {
  readonly name = "TWELVE_DATA";

  constructor(
    private readonly apiKey: string | ApiKeyResolver | undefined = resolveTwelveDataApiKey,
    private readonly fetcher: FetchLike = fetch,
  ) {}

  async search(query: string): Promise<AssetCatalogResult[]> {
    const apiKey = typeof this.apiKey === "function" ? await this.apiKey() : this.apiKey;
    if (!apiKey) throw new Error("Twelve Data API key is not configured.");

    const url = new URL("https://api.twelvedata.com/symbol_search");
    url.searchParams.set("symbol", query);
    url.searchParams.set("outputsize", "30");
    url.searchParams.set("show_plan", "true");
    url.searchParams.set("apikey", apiKey);
    const response = await this.fetcher(url, {
      headers: { Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) throw new Error(`Twelve Data search failed with status ${response.status}.`);
    const payload: unknown = await response.json();
    if (apiErrorSchema.safeParse(payload).success) throw new Error("Twelve Data rejected the search request.");

    return responseSchema.parse(payload).data
      .filter((listing) => listing.instrument_type.toUpperCase() === "ETF")
      .slice(0, 12)
      .map((listing) => ({
        source: "TWELVE_DATA" as const,
        externalId: null,
        symbol: listing.symbol.toUpperCase(),
        name: listing.instrument_name,
        imageUrl: null,
        marketCapRank: null,
        existingAssetId: null,
        assetClass: "ETF" as const,
        assetType: "ETF" as const,
        currency: listing.currency.toUpperCase(),
        quoteProvider: "TWELVE_DATA" as const,
        quoteSymbol: listing.symbol.toUpperCase(),
        quoteMicCode: listing.mic_code.toUpperCase(),
        exchange: listing.exchange,
        country: listing.country ?? null,
        accessPlan: listing.access?.plan ?? listing.access?.global ?? null,
        isSymbolConflict: false,
      }));
  }
}
