"use server";

import { revalidatePath } from "next/cache";
import { previewContribution } from "@/features/contributions/read-model";
import { ContributionPlanService } from "@/features/contributions/service";
import type { ContributionPreviewInput, SaveContributionPlanInput } from "@/features/contributions/validation";
import { IncompletePortfolioValuationError } from "@/features/portfolio-engine";
import { publicErrorMessage } from "@/lib/public-error";

export async function previewContributionAction(input: ContributionPreviewInput) {
  try {
    return { ok: true as const, data: await previewContribution(input) };
  } catch (error) {
    return { ok: false as const, message: publicErrorMessage(error, "Contribution preview could not be calculated.") };
  }
}

export async function saveContributionPlanAction(input: SaveContributionPlanInput) {
  try {
    const preview = await previewContribution({
      contributionAmount: input.contributionAmount,
      allocations: input.allocations,
    });
    if (preview.availability.state === "UNAVAILABLE") {
      throw new IncompletePortfolioValuationError(preview.availability.missingPriceSymbols);
    }
    const saved = await new ContributionPlanService().save(input);
    revalidatePath("/plan/contributions");
    revalidatePath("/portfolio");
    revalidatePath("/portfolio");
    return { ok: true as const, message: "Contribution plan saved.", savedAt: saved.updatedAt.toISOString() };
  } catch (error) {
    return { ok: false as const, message: publicErrorMessage(error, "Contribution plan could not be saved.") };
  }
}
