import "server-only";

import { z } from "zod";
import { resolveAlphaVantageApiKey } from "@/features/integrations/service";
import type { AssetCatalogProvider, AssetCatalogResult } from "@/features/asset-catalog/types";

const responseSchema = z.object({
  bestMatches: z.array(z.object({
    "1. symbol": z.string().min(1),
    "2. name": z.string().min(1),
    "3. type": z.string().min(1),
    "4. region": z.string().min(1).optional(),
    "8. currency": z.string().length(3),
    "9. matchScore": z.string().optional(),
  })),
});

const apiProblemSchema = z.union([
  z.object({ "Error Message": z.string().min(1) }),
  z.object({ Note: z.string().min(1) }),
  z.object({ Information: z.string().min(1) }),
]);

type FetchLike = typeof fetch;
type ApiKeyResolver = () => Promise<string | undefined>;

const MIC_BY_SUFFIX: Record<string, string> = {
  DEX: "XETR",
  HAM: "XHAM",
  FRA: "XFRA",
  STU: "XSTU",
  MUN: "XMUN",
  BER: "XBER",
  LON: "XLON",
  AMS: "XAMS",
  PAR: "XPAR",
  MIL: "XMIL",
  SWX: "XSWX",
};

export class AlphaVantageAssetCatalogProvider implements AssetCatalogProvider {
  readonly name = "ALPHA_VANTAGE";

  constructor(
    private readonly apiKey: string | ApiKeyResolver | undefined = resolveAlphaVantageApiKey,
    private readonly fetcher: FetchLike = fetch,
  ) {}

  async search(query: string): Promise<AssetCatalogResult[]> {
    const apiKey = typeof this.apiKey === "function" ? await this.apiKey() : this.apiKey;
    if (!apiKey) throw new Error("Alpha Vantage API key is not configured.");

    const url = new URL("https://www.alphavantage.co/query");
    url.searchParams.set("function", "SYMBOL_SEARCH");
    url.searchParams.set("keywords", query);
    url.searchParams.set("apikey", apiKey);
    const response = await this.fetcher(url, {
      headers: { Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) throw new Error(`Alpha Vantage search failed with status ${response.status}.`);
    const payload: unknown = await response.json();
    if (apiProblemSchema.safeParse(payload).success) throw new Error("Alpha Vantage rejected or throttled the search request.");

    return responseSchema.parse(payload).bestMatches
      .filter((match) => isEtfMatch(match["3. type"], match["2. name"]))
      .slice(0, 12)
      .map((match) => {
        const quoteSymbol = match["1. symbol"].toUpperCase();
        const baseSymbol = quoteSymbol.split(".")[0] ?? quoteSymbol;
        const mic = micFromAlphaSymbol(quoteSymbol);
        return {
          source: "ALPHA_VANTAGE" as const,
          externalId: null,
          symbol: baseSymbol,
          name: match["2. name"],
          imageUrl: null,
          marketCapRank: null,
          existingAssetId: null,
          assetClass: "ETF" as const,
          assetType: "ETF" as const,
          currency: match["8. currency"].toUpperCase(),
          quoteProvider: "ALPHA_VANTAGE" as const,
          quoteSymbol,
          quoteMicCode: mic,
          exchange: mic,
          country: match["4. region"] ?? null,
          accessPlan: "Free EOD",
          isSymbolConflict: false,
        };
      });
  }
}

function isEtfMatch(type: string, name: string) {
  const normalizedType = type.toUpperCase();
  const normalizedName = name.toUpperCase();
  return normalizedType === "ETF" || normalizedName.includes(" ETF") || normalizedName.includes("UCITS");
}

function micFromAlphaSymbol(symbol: string) {
  const suffix = symbol.split(".").at(-1)?.toUpperCase();
  if (!suffix || suffix === symbol.toUpperCase()) return "XNAS";
  return MIC_BY_SUFFIX[suffix] ?? suffix.slice(0, 4).padEnd(4, "X");
}
