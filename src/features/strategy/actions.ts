"use server";

import { revalidatePath } from "next/cache";
import { StrategyService } from "@/features/strategy/service";
import { toStrategyEditorModel, type StrategyEditorModel } from "@/features/strategy/read-model";
import type { UpdateStrategyInput } from "@/features/strategy/validation";
import { publicErrorMessage } from "@/lib/public-error";

export type StrategyActionState = {
  ok: boolean;
  message: string;
  saved?: StrategyEditorModel;
};

const initialState: StrategyActionState = { ok: false, message: "" };

export async function updateStrategyAction(
  previousState: StrategyActionState = initialState,
  formData: FormData,
): Promise<StrategyActionState> {
  void previousState;

  try {
    const rawPayload = formData.get("payload");
    if (typeof rawPayload !== "string") {
      throw new Error("Strategy payload is required.");
    }

    const payload = JSON.parse(rawPayload) as UpdateStrategyInput;
    const strategy = await new StrategyService().updateStrategy(payload);

    revalidatePath("/plan/strategy");
    revalidatePath("/portfolio");
    revalidatePath("/portfolio");
    revalidatePath("/plan/contributions");

    return {
      ok: true,
      message: "Strategy saved.",
      saved: toStrategyEditorModel(strategy),
    };
  } catch (error) {
    return {
      ok: false,
      message: publicErrorMessage(error, "Strategy could not be saved."),
    };
  }
}
