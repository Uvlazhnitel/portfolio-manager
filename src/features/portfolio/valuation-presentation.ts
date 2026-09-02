import type { PortfolioSnapshot } from "@/features/portfolio-engine";

export type PortfolioValuationPresentation = {
  exactTotalValue: string | null;
  knownValuedSubtotal: string;
  isPartial: boolean;
  missingPriceSymbols: string[];
};

export function buildPortfolioValuationPresentation(portfolio: PortfolioSnapshot): PortfolioValuationPresentation {
  const missingPriceSymbols = [...new Set(portfolio.missingPriceSymbols)].sort();
  const isPartial = missingPriceSymbols.length > 0;
  return {
    exactTotalValue: isPartial ? null : portfolio.totalValue,
    knownValuedSubtotal: portfolio.totalValue,
    isPartial,
    missingPriceSymbols,
  };
}

export function portfolioValuationDisplayLabel(valuation: Pick<PortfolioValuationPresentation, "isPartial">) {
  return valuation.isPartial ? "Known value" : "Portfolio value";
}
