import { getIntelligenceReadModel, type IntelligenceReadModel } from "@/features/intelligence/read-model";
import { getPerformanceReadModel, type PerformanceReadModel } from "@/features/performance/read-model";

export type AssistantToolServices = {
  getDailyBrief: () => Promise<IntelligenceReadModel>;
  getPerformance: () => Promise<PerformanceReadModel>;
};

export function createAssistantToolServices(): AssistantToolServices {
  let dailyBrief: Promise<IntelligenceReadModel> | null = null;
  let performance: Promise<PerformanceReadModel> | null = null;
  return {
    getDailyBrief: () => dailyBrief ??= getIntelligenceReadModel(),
    getPerformance: () => performance ??= getPerformanceReadModel(),
  };
}
