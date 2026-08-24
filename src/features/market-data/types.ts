import type { AssetType, MarketPriceUnit } from "@prisma/client";

export type MarketDataAsset = {
  id: string;
  symbol: string;
  name: string;
  assetType: AssetType;
  currency: string;
  externalId: string | null;
};

export type MarketPrice = {
  assetId: string;
  symbol: string;
  price: string;
  currency: string;
  timestamp: Date;
  source: string;
};

export type MarketDataRequest = {
  assets: MarketDataAsset[];
  baseCurrency: string;
};

export interface MarketDataProvider {
  readonly name: string;
  getCurrentPrices(input: MarketDataRequest): Promise<MarketPrice[]>;
}

export type ManualPriceRecord = {
  assetId: string;
  currency: string;
  price: string;
  unit: MarketPriceUnit;
  updatedAt: Date;
};

export type ResolvedMarketPrice = MarketPrice & {
  fetchedAt: Date;
  isStale: boolean;
};

export type MarketDataSnapshot = {
  prices: ResolvedMarketPrice[];
  unavailableAssetIds: string[];
  lastUpdated: string | null;
  hasStalePrices: boolean;
  wasRefreshed: boolean;
  refreshBlockedUntil: string | null;
  warning: string | null;
};
