import type { ScenarioBucket } from "@/features/scenarios/types";

export type ScenarioPreset = {
  name: "Crypto Crash" | "Equity Bear Market" | "Risk-Off" | "Bull Market";
  shocks: Record<ScenarioBucket, string>;
};

export const scenarioPresets: ScenarioPreset[] = [
  { name: "Crypto Crash", shocks: { ETF: "-10", BTC: "-50", ETH: "-55", GOLD: "5", CASH: "0" } },
  { name: "Equity Bear Market", shocks: { ETF: "-25", BTC: "-20", ETH: "-25", GOLD: "8", CASH: "0" } },
  { name: "Risk-Off", shocks: { ETF: "-15", BTC: "-35", ETH: "-40", GOLD: "10", CASH: "0" } },
  { name: "Bull Market", shocks: { ETF: "20", BTC: "35", ETH: "45", GOLD: "-5", CASH: "0" } },
];
