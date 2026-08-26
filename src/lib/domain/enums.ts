export const AssetClass = {
  ETF: "ETF",
  CRYPTO: "CRYPTO",
  GOLD: "GOLD",
  CASH: "CASH",
  OTHER: "OTHER",
} as const;

export type AssetClass = (typeof AssetClass)[keyof typeof AssetClass];

export const MarketPriceUnit = {
  ASSET_UNIT: "ASSET_UNIT",
  GRAM: "GRAM",
  TROY_OUNCE: "TROY_OUNCE",
} as const;

export type MarketPriceUnit = (typeof MarketPriceUnit)[keyof typeof MarketPriceUnit];

export const PortfolioRuleType = {
  PREFER_CONTRIBUTIONS_OVER_SELLING: "PREFER_CONTRIBUTIONS_OVER_SELLING",
  CHALLENGE_STRATEGY_VIOLATIONS: "CHALLENGE_STRATEGY_VIOLATIONS",
  PREFER_NO_ACTION_WHEN_EVIDENCE_WEAK: "PREFER_NO_ACTION_WHEN_EVIDENCE_WEAK",
  CRYPTO_MAX_ALLOCATION: "CRYPTO_MAX_ALLOCATION",
  MIN_REBALANCE_DRIFT: "MIN_REBALANCE_DRIFT",
} as const;

export type PortfolioRuleType = (typeof PortfolioRuleType)[keyof typeof PortfolioRuleType];

export const IntegrationProvider = {
  OPENAI: "OPENAI",
  COINGECKO: "COINGECKO",
  TWELVE_DATA: "TWELVE_DATA",
} as const;

export type IntegrationProvider = (typeof IntegrationProvider)[keyof typeof IntegrationProvider];
