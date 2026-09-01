import { AssetClass, AssetType } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { calculatePortfolioRisk, type EngineAsset, type PortfolioSnapshot } from "@/features/portfolio-engine";

const assets: EngineAsset[] = [
  { id: "a", symbol: "A", assetClass: AssetClass.ETF, assetType: AssetType.ETF, currency: "USD" },
  { id: "b", symbol: "BTC", assetClass: AssetClass.CRYPTO, assetType: AssetType.CRYPTO, currency: "USD" },
  { id: "c", symbol: "C", assetClass: AssetClass.GOLD, assetType: AssetType.PHYSICAL_GOLD, currency: "USD" },
  { id: "d", symbol: "D", assetClass: AssetClass.CASH, assetType: AssetType.FIAT, currency: "USD" },
];
const accounts = [
  { id: "spot", name: "Bybit Spot", type: "EXCHANGE", custodian: { id: "bybit", name: "Bybit", category: "EXCHANGE" as const } },
  { id: "earn", name: "Bybit Earn", type: "EXCHANGE", custodian: { id: "bybit", name: "Bybit", category: "EXCHANGE" as const } },
  { id: "wallet", name: "Ledger", type: "WALLET", custodian: { id: "ledger", name: "Ledger", category: "SELF_CUSTODY" as const } },
];

describe("portfolio risk engine", () => {
  it("aggregates assets, accounts, multiple accounts per custodian, and custody exposure", () => {
    const risk = calculatePortfolioRisk({ portfolio: snapshot(), assets, accounts, strategy: strategy(), thresholds: { singleAssetMaxPercent: null, custodianMaxPercent: null }, hasStalePrices: false });
    expect(risk.largestAsset).toEqual(expect.objectContaining({ subjectName: "A", valuePercent: "60.00" }));
    expect(risk.topThreeAssets.valuePercent).toBe("90.00");
    expect(risk.largestAccount).toEqual(expect.objectContaining({ subjectName: "Bybit Spot", valuePercent: "60.00" }));
    expect(risk.largestCustodian).toEqual(expect.objectContaining({ subjectName: "Bybit", valuePercent: "80.00" }));
    expect(risk.exchangeExposure.valuePercent).toBe("80.00");
    expect(risk.selfCustodyExposure.valuePercent).toBe("20.00");
    expect(risk.cryptoAllocation.valuePercent).toBe("20.00");
  });

  it("returns deterministic warnings only for enabled thresholds", () => {
    const warned = calculatePortfolioRisk({ portfolio: snapshot(), assets, accounts, strategy: strategy(), thresholds: { singleAssetMaxPercent: "50", custodianMaxPercent: "70" }, hasStalePrices: false });
    const disabled = calculatePortfolioRisk({ portfolio: snapshot(), assets, accounts, strategy: null, thresholds: { singleAssetMaxPercent: null, custodianMaxPercent: null }, hasStalePrices: false });
    expect(warned.violations.map((item) => item.code)).toEqual(expect.arrayContaining(["SINGLE_ASSET_LIMIT_EXCEEDED", "CUSTODIAN_LIMIT_EXCEEDED"]));
    expect(warned.violations.map((item) => item.code)).not.toContain("CRYPTO_LIMIT_EXCEEDED");
    expect(warned.strategyViolations.map((item) => item.code)).toContain("CRYPTO_ABOVE_MAX");
    expect(disabled.violations).toEqual([]);
  });

  it("never returns misleading percentages for incomplete valuation", () => {
    const risk = calculatePortfolioRisk({ portfolio: { ...snapshot(), totalValue: "60", missingPriceSymbols: ["BTC"] }, assets, accounts, strategy: strategy(), thresholds: { singleAssetMaxPercent: "50", custodianMaxPercent: "70" }, hasStalePrices: false });
    expect(risk.state).toBe("PARTIAL");
    for (const metric of [risk.largestAsset, risk.topThreeAssets, risk.largestAccount, risk.largestCustodian, risk.exchangeExposure, risk.cryptoAllocation]) {
      expect(metric.valuePercent).toBeNull();
      expect(metric.state).toBe("PARTIAL");
    }
    expect(risk.missingPriceSymbols).toEqual(["BTC"]);
  });

  it("marks custodian concentration partial when valued accounts are unassigned", () => {
    const risk = calculatePortfolioRisk({ portfolio: snapshot(), assets, accounts: accounts.map((account) => account.id === "wallet" ? { ...account, custodian: null } : account), strategy: null, thresholds: { singleAssetMaxPercent: null, custodianMaxPercent: null }, hasStalePrices: false });
    expect(risk.largestCustodian).toEqual(expect.objectContaining({ state: "PARTIAL", valuePercent: null }));
    expect(risk.unassignedCustodianAccountIds).toEqual(["wallet"]);
    expect(risk.selfCustodyExposure.valuePercent).toBe("20.00");
  });
});

function snapshot(): PortfolioSnapshot {
  const rows = [["a","spot","60",AssetClass.ETF,AssetType.ETF],["b","earn","20",AssetClass.CRYPTO,AssetType.CRYPTO],["c","wallet","10",AssetClass.GOLD,AssetType.PHYSICAL_GOLD],["d","wallet","10",AssetClass.CASH,AssetType.FIAT]] as const;
  return { holdings: rows.map(([assetId,accountId,value])=>({assetId,accountId,quantity:value})), valuedHoldings: rows.map(([assetId,accountId,value,assetClass,assetType])=>({assetId,accountId,quantity:value,symbol:assets.find((a)=>a.id===assetId)!.symbol,assetClass,assetType,price:"1",value})), totalValue:"100", allocation:[{assetClass:AssetClass.ETF,value:"60",percentage:"60"},{assetClass:AssetClass.CRYPTO,value:"20",percentage:"20"},{assetClass:AssetClass.GOLD,value:"10",percentage:"10"},{assetClass:AssetClass.CASH,value:"10",percentage:"10"},{assetClass:AssetClass.OTHER,value:"0",percentage:"0"}], missingPriceSymbols:[] };
}
function strategy() { return [{ assetClass: AssetClass.ETF, targetPercent:"60",minPercent:"50",maxPercent:"70" },{ assetClass: AssetClass.CRYPTO,targetPercent:"10",minPercent:"0",maxPercent:"15" },{ assetClass: AssetClass.GOLD,targetPercent:"20",minPercent:"0",maxPercent:"30" },{ assetClass: AssetClass.CASH,targetPercent:"10",minPercent:"0",maxPercent:"20" }]; }
