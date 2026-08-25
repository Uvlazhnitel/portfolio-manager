export const DEFAULT_BASE_CURRENCY = "USD" as const;

export function getCurrencyLocale(currency: string) {
  return currency.toUpperCase() === "USD" ? "en-US" : "en-IE";
}

export function getCurrencySymbol(currency: string) {
  try {
    const symbol = new Intl.NumberFormat(getCurrencyLocale(currency), {
      style: "currency",
      currency: currency.toUpperCase(),
      currencyDisplay: "narrowSymbol",
      maximumFractionDigits: 0,
    }).formatToParts(0).find((part) => part.type === "currency")?.value;
    return symbol ?? currency.toUpperCase();
  } catch {
    return currency.toUpperCase();
  }
}
