import { TransactionType, type Prisma } from "@prisma/client";
import { decimal, ONE_HUNDRED, toDecimalString, ZERO } from "@/features/portfolio-engine/decimal";
import { calculateTransactionCashValue } from "@/features/portfolio-engine/engine";
import { activeEngineTransactions } from "@/features/portfolio-engine/transactions";
import type {
  AdvancedMetricUnavailableReason,
  AdvancedPerformance,
  AdvancedPerformanceMetric,
  AdvancedPerformanceObservation,
  BenchmarkComparison,
  BenchmarkPerformanceObservation,
  CalculateAdvancedPerformanceInput,
  PeriodPerformance,
  PeriodPerformanceUnavailableReason,
  PerformanceRange,
} from "@/features/portfolio-engine/types";

const ONE = decimal(1);
const MIN_XIRR_PERIOD_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;
const XIRR_SCAN_MIN = -20;
const XIRR_SCAN_MAX = 20;
const XIRR_SCAN_STEPS = 1600;
const XIRR_BISECTION_STEPS = 200;

export function calculateAdvancedPerformance(input: CalculateAdvancedPerformanceInput): AdvancedPerformance {
  input = { ...input, transactions: activeEngineTransactions(input.transactions) };
  const observations = mergeCurrentObservation(input.history, input.current);
  const fullHistory = observations;
  const ytdHistory = observationsForYtd(observations, parseDate(input.current.date));
  const oneYearHistory = observationsForOneYear(observations, parseDate(input.current.date));

  return {
    twr: calculateTwr(fullHistory),
    xirr: calculateXirr(input),
    ytdReturn: ytdHistory ? calculateTwr(ytdHistory) : unavailable("INSUFFICIENT_HISTORY"),
    oneYearReturn: oneYearHistory ? calculateTwr(oneYearHistory) : unavailable("INSUFFICIENT_HISTORY"),
    maxDrawdown: calculateMaxDrawdown(fullHistory),
    periodPnl: Object.fromEntries(
      (["1D", "7D", "1M", "3M", "1Y", "ALL"] as const).map((range) => [
        range,
        calculatePeriodPerformance(observations, range),
      ]),
    ) as AdvancedPerformance["periodPnl"],
    comparisons: Object.fromEntries(
      (["1D", "7D", "1M", "3M", "1Y", "ALL"] as const).map((range) => [
        range,
        calculateBenchmarkComparison(observations, input.benchmark, range),
      ]),
    ) as AdvancedPerformance["comparisons"],
  };
}

export function performanceRangeCutoff(latestDate: string, range: Exclude<PerformanceRange, "ALL">) {
  const latest = parseDate(latestDate);
  if (range === "1D" || range === "7D") {
    latest.setUTCDate(latest.getUTCDate() - (range === "1D" ? 1 : 7));
    return formatDate(latest);
  }
  if (range === "1M" || range === "3M") {
    return formatDate(subtractUtcMonthsClamped(latest, range === "1M" ? 1 : 3));
  }
  return formatDate(subtractUtcYearClamped(latest));
}

export function calculatePeriodPerformance(
  observationsInput: AdvancedPerformanceObservation[],
  range: PerformanceRange,
): PeriodPerformance {
  const observations = observationsForRange(
    [...observationsInput].sort(compareObservations),
    range,
  );
  if (!observations) return unavailablePeriod("INSUFFICIENT_HISTORY");

  const returnMetric = calculateTwr(observations);
  const unavailableReasons = new Set<PeriodPerformanceUnavailableReason>();
  if (returnMetric.unavailableReason && isPeriodUnavailableReason(returnMetric.unavailableReason)) {
    unavailableReasons.add(returnMetric.unavailableReason);
  }

  const first = observations[0];
  const last = observations.at(-1)!;
  const exclusionSignatures = new Set(observations.map(performanceExclusionSignature));
  const excludedSymbols = [...new Set(
    observations.flatMap((point) => point.performanceExclusions.map((item) => item.symbol)),
  )].sort();
  let amount: string | null = null;

  if (first.investmentGain === null || last.investmentGain === null) {
    unavailableReasons.add("INCOMPLETE_COST_BASIS");
  } else if (exclusionSignatures.size > 1) {
    unavailableReasons.add("INCONSISTENT_PERFORMANCE_COVERAGE");
  } else {
    amount = toDecimalString(decimal(last.investmentGain).minus(first.investmentGain));
    if (excludedSymbols.length > 0) unavailableReasons.add("INCOMPLETE_COST_BASIS");
  }

  const returnPercent = returnMetric.value;
  const state = amount === null && returnPercent === null
    ? "UNAVAILABLE"
    : unavailableReasons.size > 0
      ? "PARTIAL"
      : "AVAILABLE";

  return {
    amount,
    returnPercent,
    state,
    startDate: first.date,
    endDate: last.date,
    isStale: observations.some((point) => point.hasStalePrices),
    excludedSymbols,
    unavailableReasons: [...unavailableReasons],
  };
}

function calculateTwr(observations: AdvancedPerformanceObservation[]): AdvancedPerformanceMetric {
  const validation = validateReturnObservations(observations);
  if (validation) return unavailable(validation, observations);

  let wealth = ONE;
  for (let index = 1; index < observations.length; index += 1) {
    const factor = intervalFactor(observations[index - 1], observations[index]);
    if (!factor || factor.isNegative()) return unavailable("INVALID_START_VALUE", observations);
    wealth = wealth.mul(factor);
  }

  return available(wealth.minus(ONE).mul(ONE_HUNDRED), observations);
}

function calculateMaxDrawdown(observations: AdvancedPerformanceObservation[]): AdvancedPerformanceMetric {
  const validation = validateReturnObservations(observations);
  if (validation) return unavailable(validation, observations);

  let wealth = ONE;
  let peak = ONE;
  let maxDrawdown = ZERO;
  for (let index = 1; index < observations.length; index += 1) {
    const factor = intervalFactor(observations[index - 1], observations[index]);
    if (!factor || factor.isNegative()) return unavailable("INVALID_START_VALUE", observations);
    wealth = wealth.mul(factor);
    if (wealth.greaterThan(peak)) peak = wealth;
    const drawdown = wealth.div(peak).minus(ONE).mul(ONE_HUNDRED);
    if (drawdown.lessThan(maxDrawdown)) maxDrawdown = drawdown;
  }

  return available(maxDrawdown, observations);
}

function calculateXirr(input: CalculateAdvancedPerformanceInput): AdvancedPerformanceMetric {
  const asOf = new Date(input.asOf);
  if (!Number.isFinite(asOf.getTime()) || !input.current.isComplete || input.current.portfolioValue === null) {
    return unavailable("INCOMPLETE_VALUATION");
  }
  const first = [...input.history]
    .sort(compareObservations)
    .find((point) => point.isComplete && point.portfolioValue !== null);
  if (!first) return unavailable("INSUFFICIENT_HISTORY");
  const firstValue = decimal(first.portfolioValue!);
  const firstDayEnd = Date.parse(`${first.date}T23:59:59.999Z`);
  if (!firstValue.greaterThan(ZERO)) return unavailable("INVALID_START_VALUE", [first, input.current]);
  if (asOf.getTime() <= firstDayEnd) return unavailable("INSUFFICIENT_HISTORY", [first, input.current]);
  const coveredDays = (startOfUtcDay(asOf).getTime() - parseDate(first.date).getTime()) / DAY_MS;
  if (coveredDays < MIN_XIRR_PERIOD_DAYS) {
    return unavailable("XIRR_PERIOD_TOO_SHORT", [first, input.current]);
  }

  const assetById = new Map(input.assets.map((asset) => [asset.id, asset]));
  const cashflows: DatedCashflow[] = [{ date: parseDate(first.date), amount: -firstValue.toNumber() }];
  for (const transaction of input.transactions) {
    if (transaction.type !== TransactionType.DEPOSIT && transaction.type !== TransactionType.WITHDRAWAL) continue;
    const timestamp = transaction.executedAt ? new Date(transaction.executedAt).getTime() : Number.NaN;
    if (!Number.isFinite(timestamp) || timestamp <= firstDayEnd || timestamp > asOf.getTime()) continue;
    const asset = assetById.get(transaction.assetId);
    if (!asset) return unavailable("INCOMPLETE_EXTERNAL_CASHFLOWS", [first, input.current]);
    const value = calculateTransactionCashValue(transaction, asset, input.baseCurrency);
    if (!value) return unavailable("INCOMPLETE_EXTERNAL_CASHFLOWS", [first, input.current]);
    cashflows.push({
      date: startOfUtcDay(new Date(timestamp)),
      amount: value.gross.toNumber() * (transaction.type === TransactionType.DEPOSIT ? -1 : 1),
    });
  }
  cashflows.push({ date: startOfUtcDay(asOf), amount: decimal(input.current.portfolioValue).toNumber() });

  const result = solveXirr(aggregateCashflows(cashflows));
  if (result.status !== "OK") {
    return unavailable(
      result.status === "AMBIGUOUS" ? "XIRR_AMBIGUOUS_SOLUTION" : "XIRR_NO_SOLUTION",
      [first, input.current],
    );
  }
  return {
    value: toDecimalString(decimal(result.rate).mul(ONE_HUNDRED)),
    startDate: first.date,
    endDate: input.current.date,
    isStale: first.hasStalePrices || input.current.hasStalePrices,
    unavailableReason: null,
  };
}

function calculateBenchmarkComparison(
  observations: AdvancedPerformanceObservation[],
  benchmark: CalculateAdvancedPerformanceInput["benchmark"],
  range: PerformanceRange,
): BenchmarkComparison {
  if (!benchmark) return unavailableComparison("BENCHMARK_NOT_CONFIGURED");
  if (observations.length < 2) return unavailableComparison("INSUFFICIENT_HISTORY");
  const latestDate = observations.at(-1)!.date;
  const cutoff = range === "ALL" ? null : performanceRangeCutoff(latestDate, range);
  const portfolioPoints = observations.filter((point) => !cutoff || point.date >= cutoff);
  if (portfolioPoints.some((point) => !point.isComplete || point.portfolioValue === null)) {
    return unavailableComparison("INCOMPLETE_VALUATION");
  }
  if (portfolioPoints.some((point) => point.externalContributions === null || point.externalWithdrawals === null)) {
    return unavailableComparison("INCOMPLETE_EXTERNAL_CASHFLOWS");
  }

  const benchmarkPoints = mergeBenchmarkCurrent(benchmark.observations, benchmark.current)
    .filter((point) => !cutoff || point.date >= cutoff);
  const benchmarkByDate = new Map(benchmarkPoints.map((point) => [point.date, point]));
  const common = portfolioPoints.flatMap((portfolio) => {
    const benchmarkPoint = benchmarkByDate.get(portfolio.date);
    return benchmarkPoint ? [{ portfolio, benchmark: benchmarkPoint }] : [];
  });
  if (common.length < 2) return unavailableComparison("MISSING_BENCHMARK_PRICES");

  const initialBenchmarkPrice = decimal(common[0].benchmark.price);
  if (!initialBenchmarkPrice.greaterThan(ZERO)) return unavailableComparison("MISSING_BENCHMARK_PRICES");
  let portfolioIndex = ONE_HUNDRED;
  const points = common.map((entry, index) => {
    if (index > 0) {
      const factor = intervalFactor(common[index - 1].portfolio, entry.portfolio);
      if (!factor || factor.isNegative()) return null;
      portfolioIndex = portfolioIndex.mul(factor);
    }
    const benchmarkIndex = decimal(entry.benchmark.price).div(initialBenchmarkPrice).mul(ONE_HUNDRED);
    return {
      date: entry.portfolio.date,
      portfolioIndex: toDecimalString(portfolioIndex, 4),
      benchmarkIndex: toDecimalString(benchmarkIndex, 4),
      portfolioReturnPercent: toDecimalString(portfolioIndex.minus(ONE_HUNDRED), 4),
      benchmarkReturnPercent: toDecimalString(benchmarkIndex.minus(ONE_HUNDRED), 4),
      hasStalePrices: entry.portfolio.hasStalePrices || entry.benchmark.hasStalePrices,
    };
  });
  if (points.some((point) => point === null)) return unavailableComparison("INVALID_START_VALUE");
  const completePoints = points.filter((point): point is NonNullable<typeof point> => point !== null);

  return {
    points: completePoints,
    startDate: completePoints[0].date,
    endDate: completePoints.at(-1)!.date,
    isPartial: common.length < portfolioPoints.length || common.length < benchmarkPoints.length,
    isStale: completePoints.some((point) => point.hasStalePrices),
    unavailableReason: null,
  };
}

function validateReturnObservations(observations: AdvancedPerformanceObservation[]): AdvancedMetricUnavailableReason | null {
  if (observations.length < 2) return "INSUFFICIENT_HISTORY";
  if (observations.some((point) => !point.isComplete || point.portfolioValue === null)) return "INCOMPLETE_VALUATION";
  if (observations.some((point) => point.externalContributions === null || point.externalWithdrawals === null)) {
    return "INCOMPLETE_EXTERNAL_CASHFLOWS";
  }
  if (!decimal(observations[0].portfolioValue!).greaterThan(ZERO)) return "INVALID_START_VALUE";
  return null;
}

function intervalFactor(start: AdvancedPerformanceObservation, end: AdvancedPerformanceObservation): Prisma.Decimal | null {
  if (start.portfolioValue === null || end.portfolioValue === null ||
    start.externalContributions === null || end.externalContributions === null ||
    start.externalWithdrawals === null || end.externalWithdrawals === null) return null;
  const startValue = decimal(start.portfolioValue);
  if (!startValue.greaterThan(ZERO)) return null;
  const contributions = decimal(end.externalContributions).minus(decimal(start.externalContributions));
  const withdrawals = decimal(end.externalWithdrawals).minus(decimal(start.externalWithdrawals));
  if (contributions.isNegative() || withdrawals.isNegative()) return null;
  return decimal(end.portfolioValue).minus(contributions).plus(withdrawals).div(startValue);
}

function observationsForYtd(observations: AdvancedPerformanceObservation[], asOf: Date) {
  const boundary = formatDate(new Date(Date.UTC(asOf.getUTCFullYear() - 1, 11, 31)));
  return observationsFromBoundary(observations, boundary);
}

function observationsForOneYear(observations: AdvancedPerformanceObservation[], asOf: Date) {
  return observationsFromBoundary(observations, formatDate(subtractUtcYearClamped(asOf)));
}

function observationsForRange(
  observations: AdvancedPerformanceObservation[],
  range: PerformanceRange,
) {
  if (observations.length < 2) return null;
  if (range === "1D") return observations.slice(-2);
  if (range === "ALL") return observations;
  const cutoff = performanceRangeCutoff(observations.at(-1)!.date, range);
  return observationsFromBoundary(observations, cutoff);
}

function observationsFromBoundary(observations: AdvancedPerformanceObservation[], boundary: string) {
  const anchor = [...observations].reverse().find((point) => point.date <= boundary);
  if (!anchor) return null;
  return observations.filter((point) => point.date >= anchor.date);
}

function mergeCurrentObservation(history: AdvancedPerformanceObservation[], current: AdvancedPerformanceObservation) {
  const byDate = new Map(history.map((point) => [point.date, point]));
  byDate.set(current.date, current);
  return [...byDate.values()].filter((point) => point.date <= current.date).sort(compareObservations);
}

function mergeBenchmarkCurrent(history: BenchmarkPerformanceObservation[], current: BenchmarkPerformanceObservation | null) {
  const byDate = new Map(history.map((point) => [point.date, point]));
  if (current) byDate.set(current.date, current);
  return [...byDate.values()].sort((left, right) => left.date.localeCompare(right.date));
}

function performanceExclusionSignature(observation: AdvancedPerformanceObservation) {
  return observation.performanceExclusions
    .map((item) => `${item.symbol}:${[...item.reasons].sort().join(",")}`)
    .sort()
    .join("|");
}

function isPeriodUnavailableReason(
  reason: AdvancedMetricUnavailableReason,
): reason is Extract<PeriodPerformanceUnavailableReason, AdvancedMetricUnavailableReason> {
  return reason === "INSUFFICIENT_HISTORY"
    || reason === "INCOMPLETE_VALUATION"
    || reason === "INCOMPLETE_EXTERNAL_CASHFLOWS"
    || reason === "INVALID_START_VALUE";
}

function unavailablePeriod(reason: PeriodPerformanceUnavailableReason): PeriodPerformance {
  return {
    amount: null,
    returnPercent: null,
    state: "UNAVAILABLE",
    startDate: null,
    endDate: null,
    isStale: false,
    excludedSymbols: [],
    unavailableReasons: [reason],
  };
}

function available(value: Prisma.Decimal, observations: AdvancedPerformanceObservation[]): AdvancedPerformanceMetric {
  return {
    value: toDecimalString(value),
    startDate: observations[0]?.date ?? null,
    endDate: observations.at(-1)?.date ?? null,
    isStale: observations.some((point) => point.hasStalePrices),
    unavailableReason: null,
  };
}

function unavailable(reason: AdvancedMetricUnavailableReason, observations: AdvancedPerformanceObservation[] = []): AdvancedPerformanceMetric {
  return {
    value: null,
    startDate: observations[0]?.date ?? null,
    endDate: observations.at(-1)?.date ?? null,
    isStale: observations.some((point) => point.hasStalePrices),
    unavailableReason: reason,
  };
}

function unavailableComparison(reason: AdvancedMetricUnavailableReason): BenchmarkComparison {
  return { points: [], startDate: null, endDate: null, isPartial: false, isStale: false, unavailableReason: reason };
}

type DatedCashflow = { date: Date; amount: number };

function aggregateCashflows(cashflows: DatedCashflow[]) {
  const byDate = new Map<string, number>();
  for (const cashflow of cashflows) {
    const date = formatDate(cashflow.date);
    byDate.set(date, (byDate.get(date) ?? 0) + cashflow.amount);
  }
  return [...byDate.entries()]
    .map(([date, amount]) => ({ date: parseDate(date), amount }))
    .sort((left, right) => left.date.getTime() - right.date.getTime());
}

function solveXirr(cashflows: DatedCashflow[]): { status: "OK"; rate: number } | { status: "NONE" | "AMBIGUOUS" } {
  if (cashflows.length < 2 || !cashflows.some((flow) => flow.amount < 0) || !cashflows.some((flow) => flow.amount > 0)) {
    return { status: "NONE" };
  }
  const firstDate = cashflows[0].date.getTime();
  const scale = Math.max(...cashflows.map((flow) => Math.abs(flow.amount)), 1);
  const tolerance = scale * 1e-10;
  const npv = (logRate: number) => cashflows.reduce((sum, flow) => {
    const years = (flow.date.getTime() - firstDate) / (365 * 24 * 60 * 60 * 1000);
    return sum + flow.amount * Math.exp(-logRate * years);
  }, 0);
  const roots: number[] = [];
  let left = XIRR_SCAN_MIN;
  let leftValue = npv(left);
  for (let step = 1; step <= XIRR_SCAN_STEPS; step += 1) {
    const right = XIRR_SCAN_MIN + ((XIRR_SCAN_MAX - XIRR_SCAN_MIN) * step) / XIRR_SCAN_STEPS;
    const rightValue = npv(right);
    if (Number.isFinite(leftValue) && Math.abs(leftValue) <= tolerance) roots.push(left);
    if (Number.isFinite(leftValue) && Number.isFinite(rightValue) && leftValue * rightValue < 0) {
      roots.push(bisectRoot(npv, left, right, tolerance));
    }
    left = right;
    leftValue = rightValue;
  }
  if (Number.isFinite(leftValue) && Math.abs(leftValue) <= tolerance) roots.push(left);
  const uniqueRoots = roots
    .sort((a, b) => a - b)
    .filter((root, index, values) => index === 0 || Math.abs(root - values[index - 1]) > 1e-7);
  if (uniqueRoots.length === 0) return { status: "NONE" };
  if (uniqueRoots.length > 1) return { status: "AMBIGUOUS" };
  return { status: "OK", rate: Math.exp(uniqueRoots[0]) - 1 };
}

function bisectRoot(npv: (rate: number) => number, initialLeft: number, initialRight: number, tolerance: number) {
  let left = initialLeft;
  let right = initialRight;
  let leftValue = npv(left);
  for (let index = 0; index < XIRR_BISECTION_STEPS; index += 1) {
    const middle = (left + right) / 2;
    const middleValue = npv(middle);
    if (Math.abs(middleValue) <= tolerance) return middle;
    if (leftValue * middleValue <= 0) {
      right = middle;
    } else {
      left = middle;
      leftValue = middleValue;
    }
  }
  return (left + right) / 2;
}

function subtractUtcMonthsClamped(date: Date, months: number) {
  const totalMonths = date.getUTCFullYear() * 12 + date.getUTCMonth() - months;
  const year = Math.floor(totalMonths / 12);
  const month = ((totalMonths % 12) + 12) % 12;
  const day = Math.min(date.getUTCDate(), daysInUtcMonth(year, month));
  return new Date(Date.UTC(year, month, day));
}

function subtractUtcYearClamped(date: Date) {
  const year = date.getUTCFullYear() - 1;
  const month = date.getUTCMonth();
  const day = Math.min(date.getUTCDate(), daysInUtcMonth(year, month));
  return new Date(Date.UTC(year, month, day));
}

function daysInUtcMonth(year: number, month: number) {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

function compareObservations(left: AdvancedPerformanceObservation, right: AdvancedPerformanceObservation) {
  return left.date.localeCompare(right.date);
}

function startOfUtcDay(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function parseDate(value: string) {
  const date = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(date.getTime())) throw new Error(`Invalid performance date ${value}.`);
  return date;
}

function formatDate(value: Date) {
  return value.toISOString().slice(0, 10);
}
