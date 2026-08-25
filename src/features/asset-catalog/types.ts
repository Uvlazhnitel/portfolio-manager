export type AssetCatalogSource = "LOCAL" | "COINGECKO";

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
