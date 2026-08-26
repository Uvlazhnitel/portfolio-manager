export type AssetCatalogSource = "LOCAL" | "COINGECKO" | "TWELVE_DATA";
export type AssetCatalogKind = "CRYPTO" | "ETF";

export type AssetCatalogResult = {
  source: AssetCatalogSource;
  externalId: string | null;
  symbol: string;
  name: string;
  imageUrl: string | null;
  marketCapRank: number | null;
  existingAssetId: string | null;
  assetClass: "ETF" | "CRYPTO" | "GOLD" | "CASH" | "OTHER";
  assetType: "CRYPTO" | "ETF" | "PHYSICAL_GOLD" | "TOKENIZED_GOLD" | "FIAT" | "STABLECOIN" | "OTHER";
  currency: string;
  quoteProvider: "TWELVE_DATA" | null;
  quoteSymbol: string | null;
  quoteMicCode: string | null;
  exchange: string | null;
  country: string | null;
  accessPlan: string | null;
  isSymbolConflict: boolean;
};

export type AssetCatalogSearchResult = {
  results: AssetCatalogResult[];
  warning: string | null;
};

export interface AssetCatalogProvider {
  readonly name: string;
  search(query: string): Promise<AssetCatalogResult[]>;
}
