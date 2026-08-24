"use server";

import { revalidatePath } from "next/cache";
import { previewContribution } from "@/features/contributions/read-model";
import { ContributionPlanService } from "@/features/contributions/service";
import type { ContributionPreviewInput, SaveContributionPlanInput } from "@/features/contributions/validation";

export async function previewContributionAction(input: ContributionPreviewInput) {
  try {
    return { ok: true as const, data: await previewContribution(input) };
  } catch (error) {
    return { ok: false as const, message: error instanceof Error ? error.message : "Contribution preview could not be calculated." };
  }
}

export async function saveContributionPlanAction(input: SaveContributionPlanInput) {
  try {
    const saved = await new ContributionPlanService().save(input);
    revalidatePath("/plan/contributions");
    revalidatePath("/dashboard");
    revalidatePath("/portfolio");
    return { ok: true as const, message: "Contribution plan saved.", savedAt: saved.updatedAt.toISOString() };
  } catch (error) {
    return { ok: false as const, message: error instanceof Error ? error.message : "Contribution plan could not be saved." };
  }
}
