import "server-only";

import { CoinGeckoAssetCatalogProvider } from "@/features/asset-catalog/providers/coingecko";
import { TwelveDataAssetCatalogProvider } from "@/features/asset-catalog/providers/twelve-data";
import type { AssetCatalogKind, AssetCatalogProvider, AssetCatalogResult, AssetCatalogSearchResult } from "@/features/asset-catalog/types";
import { PortfolioRepository } from "@/features/portfolio/repository";

export const ASSET_CATALOG_CACHE_TTL_MS = 15 * 60 * 1_000;

type CatalogAsset = Awaited<ReturnType<PortfolioRepository["listAssets"]>>[number];
type CatalogStore = Pick<PortfolioRepository, "listAssets">;
type CacheEntry = { expiresAt: number; results: AssetCatalogResult[] };

const searchCache = new Map<string, CacheEntry>();
const inFlightSearches = new Map<string, Promise<AssetCatalogResult[]>>();

export class AssetCatalogService {
  constructor(
    private readonly store: CatalogStore = new PortfolioRepository(),
    private readonly providers: Record<AssetCatalogKind, AssetCatalogProvider> = {
      CRYPTO: new CoinGeckoAssetCatalogProvider(),
      ETF: new TwelveDataAssetCatalogProvider(),
    },
  ) {}

  async search(query: string, kind: AssetCatalogKind = "CRYPTO", now = Date.now()): Promise<AssetCatalogSearchResult> {
    const normalizedQuery = query.trim().toLowerCase();
    const assets = await this.store.listAssets();
    const local = localMatches(assets, normalizedQuery, kind);
    const provider = this.providers[kind];

    try {
      const remote = await cachedSearch(provider, normalizedQuery, now);
      return { results: mergeResults(local, remote, assets), warning: null };
    } catch {
      return {
        results: local,
        warning: "Online asset search is temporarily unavailable. Local assets are still available.",
      };
    }
  }
}

function localMatches(assets: CatalogAsset[], query: string, kind: AssetCatalogKind): AssetCatalogResult[] {
  return assets
    .filter((asset) => (kind === "ETF" ? asset.assetType === "ETF" : asset.assetType !== "ETF"))
    .filter((asset) => asset.symbol.toLowerCase().includes(query) || asset.name.toLowerCase().includes(query))
    .map((asset) => ({
      source: "LOCAL" as const,
      externalId: asset.externalId,
      symbol: asset.symbol,
      name: asset.name,
      imageUrl: imageUrlFromMetadata(asset.metadata),
      marketCapRank: null,
      existingAssetId: asset.id,
      assetClass: asset.assetClass,
      assetType: asset.assetType,
      currency: asset.currency,
      quoteProvider: asset.quoteProvider,
      quoteSymbol: asset.quoteSymbol,
      quoteMicCode: asset.quoteMicCode,
      exchange: asset.quoteMicCode,
      country: null,
      accessPlan: null,
      isSymbolConflict: false,
    }));
}

async function cachedSearch(provider: AssetCatalogProvider, query: string, now: number) {
  const key = `${provider.name}:${query}`;
  const cached = searchCache.get(key);
  if (cached && cached.expiresAt > now) return cached.results;
  const existing = inFlightSearches.get(key);
  if (existing) return existing;

  const request = provider.search(query).then((results) => {
    searchCache.set(key, { expiresAt: now + ASSET_CATALOG_CACHE_TTL_MS, results });
    return results;
  }).finally(() => inFlightSearches.delete(key));
  inFlightSearches.set(key, request);
  return request;
}

function mergeResults(local: AssetCatalogResult[], remote: AssetCatalogResult[], assets: CatalogAsset[]) {
  const localExternalIds = new Set(local.map((asset) => asset.externalId).filter(Boolean));
  const localIds = new Set(local.map((asset) => asset.existingAssetId));
  const existingByExternalId = new Map(assets.filter((asset) => asset.externalId).map((asset) => [asset.externalId, asset]));
  const existingByQuoteIdentity = new Map(assets.flatMap((asset) => {
    const identity = quoteIdentity(asset);
    return identity ? [[identity, asset] as const] : [];
  }));
  const existingBySymbol = new Map(assets.map((asset) => [asset.symbol.toUpperCase(), asset]));

  const merged = [...local];
  for (const candidate of remote) {
    if (candidate.externalId && localExternalIds.has(candidate.externalId)) continue;
    const byExternalId = candidate.externalId ? existingByExternalId.get(candidate.externalId) : undefined;
    const candidateQuoteIdentity = quoteIdentity(candidate);
    const byQuoteIdentity = candidateQuoteIdentity ? existingByQuoteIdentity.get(candidateQuoteIdentity) : undefined;
    const bySymbol = existingBySymbol.get(candidate.symbol.toUpperCase());
    const remappableEtf = candidate.source === "TWELVE_DATA" && bySymbol?.assetType === "ETF" ? bySymbol : undefined;
    const exactExisting = byExternalId ?? byQuoteIdentity;
    if (exactExisting && localIds.has(exactExisting.id)) continue;
    merged.push({
      ...candidate,
      existingAssetId: (byExternalId ?? byQuoteIdentity ?? remappableEtf)?.id ?? null,
      isSymbolConflict: Boolean(bySymbol && !remappableEtf && bySymbol.externalId !== candidate.externalId),
    });
  }
  return merged.slice(0, 12);
}

function quoteIdentity(asset: Pick<AssetCatalogResult, "quoteProvider" | "quoteSymbol" | "quoteMicCode"> | CatalogAsset) {
  return asset.quoteProvider && asset.quoteSymbol && asset.quoteMicCode
    ? `${asset.quoteProvider}:${asset.quoteSymbol.toUpperCase()}:${asset.quoteMicCode.toUpperCase()}`
    : null;
}

function imageUrlFromMetadata(metadata: unknown) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata) || !("imageUrl" in metadata)) return null;
  return typeof metadata.imageUrl === "string" ? metadata.imageUrl : null;
}

export function resetAssetCatalogRuntimeCacheForTests() {
  searchCache.clear();
  inFlightSearches.clear();
}
