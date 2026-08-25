"use server";

import { MarketPriceUnit } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { MarketDataService } from "@/features/market-data/service";
import { saveManualMarketPriceMutation } from "@/features/market-data/mutations";
import { PortfolioRepository } from "@/features/portfolio/repository";
import { StrategyRepository } from "@/features/strategy/repository";
import { DEFAULT_BASE_CURRENCY } from "@/lib/domain/currency";
import { publicErrorMessage } from "@/lib/public-error";

export type MarketDataActionState = {
  ok: boolean;
  message: string;
  refreshBlockedUntil?: string | null;
};

const initialState: MarketDataActionState = { ok: false, message: "" };

export async function refreshPricesAction(
  previousState: MarketDataActionState = initialState,
): Promise<MarketDataActionState> {
  void previousState;

  try {
    const [assets, strategy] = await Promise.all([
      new PortfolioRepository().listAssets(),
      new StrategyRepository().findActiveStrategy(),
    ]);
    const snapshot = await new MarketDataService().getCurrentPrices({
      assets,
      baseCurrency: strategy?.baseCurrency ?? DEFAULT_BASE_CURRENCY,
      forceRefresh: true,
    });
    revalidateMarketDataPages();

    return {
      ok: snapshot.wasRefreshed || snapshot.prices.length > 0,
      message: snapshot.warning
        ? `Using cached prices. ${snapshot.warning}`
        : snapshot.wasRefreshed
          ? "Prices refreshed."
          : "Prices are already fresh. Please wait before refreshing again.",
      refreshBlockedUntil: snapshot.refreshBlockedUntil,
    };
  } catch (error) {
    return toActionError(error);
  }
}

export async function saveManualMarketPriceAction(
  previousState: MarketDataActionState = initialState,
  formData: FormData,
): Promise<MarketDataActionState> {
  void previousState;

  try {
    const result = await saveManualMarketPriceMutation({
      assetId: String(formData.get("assetId") ?? ""),
      price: String(formData.get("price") ?? ""),
      currency: String(formData.get("currency") ?? DEFAULT_BASE_CURRENCY),
      unit: String(formData.get("unit") ?? MarketPriceUnit.ASSET_UNIT) as MarketPriceUnit,
    });
    revalidateMarketDataPages();
    return result;
  } catch (error) {
    return toActionError(error);
  }
}

function revalidateMarketDataPages() {
  revalidatePath("/portfolio");
  revalidatePath("/dashboard");
  revalidatePath("/settings");
}

function toActionError(error: unknown): MarketDataActionState {
  return {
    ok: false,
    message: publicErrorMessage(error, "Market price could not be updated."),
  };
}
