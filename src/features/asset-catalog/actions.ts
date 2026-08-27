"use server";

import { z } from "zod";
import { AssetCatalogService, validateSearchQuery } from "@/features/asset-catalog/service";
import type { AssetCatalogSearchResult } from "@/features/asset-catalog/types";
import type { AssetCatalogKind } from "@/features/asset-catalog/types";
import { publicErrorMessage } from "@/lib/public-error";

const searchQuerySchema = z.string().trim().max(80);
const searchKindSchema = z.enum(["CRYPTO", "ETF"]);

export type AssetSearchActionResult = AssetCatalogSearchResult & { ok: boolean; message: string | null };

export async function searchAssetsAction(query: string, kind: AssetCatalogKind = "CRYPTO"): Promise<AssetSearchActionResult> {
  try {
    const parsedKind = searchKindSchema.parse(kind);
    const parsed = searchQuerySchema.parse(query);
    validateSearchQuery(parsed, parsedKind);
    const result = await new AssetCatalogService().search(parsed, parsedKind);
    return { ok: true, message: null, ...result };
  } catch (error) {
    return {
      ok: false,
      results: [],
      warning: null,
      message: publicErrorMessage(error, "Asset search could not be completed."),
    };
  }
}
