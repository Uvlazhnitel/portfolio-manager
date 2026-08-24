"use client";

import { useActionState, useMemo, useState } from "react";
import { MarketPriceUnit } from "@prisma/client";
import { saveManualMarketPriceAction } from "@/features/market-data/actions";
import type { MarketDataSettingsModel } from "@/features/market-data/settings-read-model";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export function ManualPrices({ assets }: { assets: MarketDataSettingsModel }) {
  const [assetId, setAssetId] = useState(assets[0]?.id ?? "");
  const selectedAsset = useMemo(() => assets.find((asset) => asset.id === assetId), [assetId, assets]);
  const isPhysicalGold = selectedAsset?.assetType === "PHYSICAL_GOLD";
  const [state, action, isPending] = useActionState(saveManualMarketPriceAction, {
    ok: false,
    message: "",
  });

  return (
    <div className="grid gap-4 lg:grid-cols-[0.9fr_1.1fr]">
      <Card>
        <h2 className="text-lg font-semibold text-foreground">Set manual price</h2>
        <p className="mt-2 text-sm leading-6 text-muted">
          Used when an external provider is unavailable or has no adapter for the asset.
        </p>

        <form action={action} className="mt-6 space-y-4">
          <label className="block text-sm">
            <span className="mb-2 block font-medium text-muted">Asset</span>
            <select
              name="assetId"
              value={assetId}
              onChange={(event) => setAssetId(event.target.value)}
              className={inputClassName}
              required
            >
              {assets.map((asset) => (
                <option key={asset.id} value={asset.id}>{asset.name} ({asset.symbol})</option>
              ))}
            </select>
          </label>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block text-sm">
              <span className="mb-2 block font-medium text-muted">Price</span>
              <input name="price" inputMode="decimal" className={inputClassName} required placeholder="0.00" />
            </label>
            <label className="block text-sm">
              <span className="mb-2 block font-medium text-muted">Currency</span>
              <input name="currency" className={inputClassName} value="EUR" readOnly />
            </label>
          </div>

          <label className="block text-sm">
            <span className="mb-2 block font-medium text-muted">Quoted per</span>
            <select name="unit" className={inputClassName} defaultValue={isPhysicalGold ? MarketPriceUnit.TROY_OUNCE : MarketPriceUnit.ASSET_UNIT} key={String(isPhysicalGold)}>
              {isPhysicalGold ? (
                <>
                  <option value={MarketPriceUnit.TROY_OUNCE}>Troy ounce (31.1034768 g)</option>
                  <option value={MarketPriceUnit.GRAM}>Gram</option>
                </>
              ) : (
                <option value={MarketPriceUnit.ASSET_UNIT}>Asset unit</option>
              )}
            </select>
          </label>

          {isPhysicalGold ? (
            <p className="rounded-lg border border-primary/25 bg-primary/10 p-3 text-sm text-muted">
              Physical gold holdings are stored in grams. Troy-ounce quotes are normalized server-side using the exact precious-metals unit.
            </p>
          ) : null}

          {state.message ? (
            <p className={cn("rounded-lg border p-3 text-sm", state.ok ? "border-success/30 bg-success/10 text-success" : "border-destructive/30 bg-destructive/10 text-destructive")}>{state.message}</p>
          ) : null}

          <Button type="submit" disabled={isPending || assets.length === 0}>
            {isPending ? "Saving..." : "Save manual price"}
          </Button>
        </form>
      </Card>

      <Card>
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-foreground">Configured prices</h2>
            <p className="mt-1 text-sm text-muted">Manual values remain visible with their timestamp.</p>
          </div>
          <Badge tone="primary">EUR</Badge>
        </div>
        <div className="mt-5 space-y-3">
          {assets.filter((asset) => asset.manualPrice).length === 0 ? (
            <p className="rounded-lg border border-border bg-surface p-4 text-sm text-muted">No manual prices configured.</p>
          ) : assets.filter((asset) => asset.manualPrice).map((asset) => (
            <div key={asset.id} className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="font-medium text-foreground">{asset.name}</p>
                <p className="text-sm text-muted">{asset.symbol} · {formatUnit(asset.manualPrice?.unit)}</p>
              </div>
              <div className="sm:text-right">
                <p className="font-medium text-foreground">€{asset.manualPrice?.price}</p>
                <p className="text-xs text-muted">Updated {asset.manualPrice ? new Date(asset.manualPrice.updatedAt).toLocaleString() : "—"}</p>
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

function formatUnit(unit: string | undefined) {
  if (unit === MarketPriceUnit.TROY_OUNCE) return "per troy ounce";
  if (unit === MarketPriceUnit.GRAM) return "per gram";
  return "per asset unit";
}

const inputClassName = "h-10 w-full rounded-lg border border-border bg-surface-strong px-3 text-sm text-foreground outline-none transition placeholder:text-muted/70 focus:border-primary/60";
