import { ZodError } from "zod";

const safeErrorNames = new Set([
  "IncompletePortfolioValuationError",
  "PortfolioMutationError",
  "StrategyAllocationValidationError",
]);

const safeMessagePrefixes = [
  "Asset ",
  "Cannot ",
  "Contribution ",
  "Custom allocation ",
  "Minimum ",
  "Only ",
  "Percentages ",
  "Price ",
  "Quantity ",
  "Selected ",
  "Source ",
  "Strategy ",
  "This transaction ",
  "Transaction ",
  "Use ",
  "Weight ",
];

export function publicErrorMessage(error: unknown, fallback: string) {
  if (error instanceof ZodError) {
    return error.issues[0]?.message ?? fallback;
  }
  if (!(error instanceof Error)) return fallback;
  if (safeErrorNames.has(error.name) || safeMessagePrefixes.some((prefix) => error.message.startsWith(prefix))) {
    return error.message.slice(0, 240);
  }
  return fallback;
}
