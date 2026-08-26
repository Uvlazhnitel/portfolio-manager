"use server";

import { z } from "zod";
import { AssetCatalogService } from "@/features/asset-catalog/service";
import type { AssetCatalogSearchResult } from "@/features/asset-catalog/types";
import type { AssetCatalogKind } from "@/features/asset-catalog/types";
import { publicErrorMessage } from "@/lib/public-error";

const searchQuerySchema = z.string().trim().min(2, "Enter at least two characters.").max(80);
const searchKindSchema = z.enum(["CRYPTO", "ETF"]);

export type AssetSearchActionResult = AssetCatalogSearchResult & { ok: boolean; message: string | null };

export async function searchAssetsAction(query: string, kind: AssetCatalogKind = "CRYPTO"): Promise<AssetSearchActionResult> {
  try {
    const parsed = searchQuerySchema.parse(query);
    const result = await new AssetCatalogService().search(parsed, searchKindSchema.parse(kind));
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
