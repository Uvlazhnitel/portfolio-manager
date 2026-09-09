import { decimal } from "@/features/portfolio-engine/decimal";
import type { AssetClassAllocation, PortfolioSnapshot, ValuedHolding } from "@/features/portfolio-engine/types";

export function exactHoldingPrice(holding: ValuedHolding) {
  return decimal(holding.exactPrice ?? holding.price);
}

export function exactHoldingValue(holding: ValuedHolding) {
  return decimal(holding.exactValue ?? holding.value);
}

export function exactPortfolioValue(portfolio: PortfolioSnapshot) {
  return decimal(portfolio.exactTotalValue ?? portfolio.totalValue);
}

export function exactAllocationValue(allocation: AssetClassAllocation) {
  return decimal(allocation.exactValue ?? allocation.value);
}

export function exactAllocationPercentage(allocation: AssetClassAllocation) {
  return decimal(allocation.exactPercentage ?? allocation.percentage);
}
