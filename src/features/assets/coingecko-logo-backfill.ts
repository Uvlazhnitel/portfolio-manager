import { type Prisma, type PrismaClient } from "@prisma/client";
import { resolveCoinGeckoApiKey } from "@/features/integrations/service";
import { prisma } from "@/lib/db/client";

type FetchLike = typeof fetch;
type ApiKeyResolver = () => Promise<string | undefined>;

export type BackfillCoinGeckoLogosResult = {
  scanned: number;
  updated: number;
  skipped: number;
  missing: string[];
  warnings: string[];
};

type CoinGeckoMarketCoin = {
  id?: unknown;
  image?: unknown;
};

export async function backfillCoinGeckoLogos({
  db = prisma,
  fetcher = fetch,
  apiKey = resolveCoinGeckoApiKey,
}: {
  db?: PrismaClient | Prisma.TransactionClient;
  fetcher?: FetchLike;
  apiKey?: string | ApiKeyResolver | undefined;
} = {}): Promise<BackfillCoinGeckoLogosResult> {
  const assets = await db.asset.findMany({
    where: { externalId: { not: null } },
    select: { id: true, symbol: true, externalId: true, metadata: true },
    orderBy: { symbol: "asc" },
  });
  const candidates = assets.filter((asset) => !imageUrlFromMetadata(asset.metadata));
  const result: BackfillCoinGeckoLogosResult = {
    scanned: assets.length,
    updated: 0,
    skipped: assets.length - candidates.length,
    missing: [],
    warnings: [],
  };

  const ids = [...new Set(candidates.map((asset) => asset.externalId).filter((id): id is string => Boolean(id)))];
  const logoByExternalId = await fetchCoinGeckoLogos({ ids, fetcher, apiKey, warnings: result.warnings });

  for (const asset of candidates) {
    if (!asset.externalId) continue;
    const imageUrl = logoByExternalId.get(asset.externalId);
    if (!imageUrl) {
      result.missing.push(asset.symbol);
      continue;
    }

    await db.asset.update({
      where: { id: asset.id },
      data: { metadata: metadataWithImageUrl(asset.metadata, imageUrl) },
    });
    result.updated += 1;
  }

  result.missing.sort();
  return result;
}

async function fetchCoinGeckoLogos({
  ids,
  fetcher,
  apiKey,
  warnings,
}: {
  ids: string[];
  fetcher: FetchLike;
  apiKey: string | ApiKeyResolver | undefined;
  warnings: string[];
}) {
  const logos = new Map<string, string>();
  const resolvedApiKey = typeof apiKey === "function" ? await apiKey() : apiKey;

  for (const chunk of chunks(ids, 100)) {
    if (chunk.length === 0) continue;
    const url = new URL("https://api.coingecko.com/api/v3/coins/markets");
    url.searchParams.set("vs_currency", "usd");
    url.searchParams.set("ids", chunk.join(","));
    url.searchParams.set("order", "market_cap_desc");
    url.searchParams.set("per_page", String(chunk.length));
    url.searchParams.set("page", "1");
    url.searchParams.set("sparkline", "false");

    const headers = new Headers({ Accept: "application/json" });
    if (resolvedApiKey) headers.set("x-cg-demo-api-key", resolvedApiKey);

    const response = await fetcher(url, {
      headers,
      cache: "no-store",
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) {
      warnings.push(`CoinGecko logo lookup failed with status ${response.status}.`);
      continue;
    }

    const payload = await response.json();
    if (!Array.isArray(payload)) {
      warnings.push("CoinGecko logo lookup returned an unexpected payload.");
      continue;
    }

    for (const coin of payload as CoinGeckoMarketCoin[]) {
      if (typeof coin.id !== "string") continue;
      const imageUrl = safeCoinGeckoImageUrl(typeof coin.image === "string" ? coin.image : null);
      if (imageUrl) logos.set(coin.id, imageUrl);
    }
  }

  return logos;
}

function imageUrlFromMetadata(metadata: Prisma.JsonValue | null) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata) || !("imageUrl" in metadata)) return null;
  return typeof metadata.imageUrl === "string" ? metadata.imageUrl : null;
}

function metadataWithImageUrl(metadata: Prisma.JsonValue | null, imageUrl: string): Prisma.InputJsonValue {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return { imageUrl };
  return { ...metadata, imageUrl } as Prisma.InputJsonObject;
}

function safeCoinGeckoImageUrl(value: string | null | undefined) {
  if (!value) return null;
  const url = new URL(value);
  if (url.protocol !== "https:" || !["assets.coingecko.com", "coin-images.coingecko.com"].includes(url.hostname)) {
    return null;
  }
  return url.toString();
}

function chunks<T>(values: T[], size: number) {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}
