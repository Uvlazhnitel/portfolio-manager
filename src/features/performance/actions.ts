"use server";

import { revalidatePath } from "next/cache";
import { StrategyService } from "@/features/strategy/service";
import { publicErrorMessage } from "@/lib/public-error";

export type BenchmarkActionState = {
  ok: boolean;
  message: string;
};

export const initialBenchmarkActionState: BenchmarkActionState = { ok: false, message: "" };

export async function updatePerformanceBenchmarkAction(
  previousState: BenchmarkActionState = initialBenchmarkActionState,
  formData: FormData,
): Promise<BenchmarkActionState> {
  void previousState;
  try {
    const strategyId = formData.get("strategyId");
    const benchmarkAssetId = formData.get("benchmarkAssetId");
    if (typeof strategyId !== "string") throw new Error("Strategy is required.");
    if (typeof benchmarkAssetId !== "string") throw new Error("Benchmark selection is required.");
    await new StrategyService().updateBenchmark(strategyId, benchmarkAssetId || null);
    revalidatePath("/performance");
    return { ok: true, message: "Benchmark updated." };
  } catch (error) {
    return { ok: false, message: publicErrorMessage(error, "Benchmark could not be updated.") };
  }
}
