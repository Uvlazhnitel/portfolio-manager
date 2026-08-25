import { DEFAULT_BASE_CURRENCY, getCurrencyLocale } from "@/lib/domain/currency";

export function formatDecimalCurrency(value: string, currency: string = DEFAULT_BASE_CURRENCY, places = 2) {
  const fixed = normalizeFixedDecimal(value, places);
  if (!fixed) return "—";
  const { negative, whole, fraction } = splitFixed(fixed);
  try {
    const parts = new Intl.NumberFormat(getCurrencyLocale(currency), {
      style: "currency",
      currency,
      minimumFractionDigits: places,
      maximumFractionDigits: places,
    }).formatToParts(BigInt(whole));
    const formatted = parts.map((part) => part.type === "fraction" ? fraction : part.value).join("");
    return negative ? `−${formatted}` : formatted;
  } catch {
    return "—";
  }
}

export function formatDecimalPercent(value: string, places = 2) {
  const fixed = normalizeFixedDecimal(value, places);
  if (!fixed) return "—";
  const { negative, whole, fraction } = splitFixed(fixed);
  const grouped = new Intl.NumberFormat("en-IE", { maximumFractionDigits: 0 }).format(BigInt(whole));
  return `${negative ? "−" : ""}${grouped}${places > 0 ? `.${fraction}` : ""}%`;
}

export function decimalSign(value: string) {
  const fixed = normalizeFixedDecimal(value, 8);
  if (!fixed) return null;
  const { negative, whole, fraction } = splitFixed(fixed);
  if (/^0+$/.test(`${whole}${fraction}`)) return 0;
  return negative ? -1 : 1;
}

function normalizeFixedDecimal(value: string, places: number) {
  const match = value.trim().match(/^(-)?(\d+)(?:\.(\d+))?$/);
  if (!match || places < 0 || !Number.isSafeInteger(places)) return null;
  const negative = Boolean(match[1]);
  const whole = (match[2] ?? "0").replace(/^0+(?=\d)/, "");
  const fraction = match[3] ?? "";
  const retained = fraction.slice(0, places).padEnd(places, "0");
  let units = BigInt(`${whole}${retained}` || "0");
  if ((fraction[places] ?? "0") >= "5") units += BigInt(1);
  const digits = units.toString().padStart(places + 1, "0");
  const fixedWhole = places === 0 ? digits : digits.slice(0, -places);
  const fixedFraction = places === 0 ? "" : digits.slice(-places);
  const isZero = /^0+$/.test(`${fixedWhole}${fixedFraction}`);
  return `${negative && !isZero ? "-" : ""}${fixedWhole}${places > 0 ? `.${fixedFraction}` : ""}`;
}

function splitFixed(value: string) {
  const negative = value.startsWith("-");
  const [whole, fraction = ""] = (negative ? value.slice(1) : value).split(".");
  return { negative, whole, fraction };
}
