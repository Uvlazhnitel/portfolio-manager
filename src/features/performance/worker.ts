import { captureDailyMarketPrices, type DailyCaptureResult } from "@/features/performance/capture";

export const HISTORY_CAPTURE_UTC_HOUR = 23;
export const HISTORY_CAPTURE_UTC_MINUTE = 55;
export const HISTORY_RETRY_DELAY_MS = 5 * 60 * 1_000;

type WorkerDependencies = {
  capture?: () => Promise<DailyCaptureResult>;
  wait?: (milliseconds: number) => Promise<void>;
  now?: () => Date;
  shouldStop?: () => boolean;
  onSuccess?: (result: DailyCaptureResult) => void;
  onError?: (error: unknown) => void;
};

export async function runHistoryWorker({
  capture = () => captureDailyMarketPrices(),
  wait = waitFor,
  now = () => new Date(),
  shouldStop = () => false,
  onSuccess = () => undefined,
  onError = () => undefined,
}: WorkerDependencies = {}) {
  while (!shouldStop()) {
    try {
      const result = await capture();
      onSuccess(result);
      if (shouldStop()) break;
      await wait(millisecondsUntilNextCapture(now()));
    } catch (error) {
      onError(error);
      if (shouldStop()) break;
      await wait(HISTORY_RETRY_DELAY_MS);
    }
  }
}

export function millisecondsUntilNextCapture(now: Date) {
  const next = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
    HISTORY_CAPTURE_UTC_HOUR,
    HISTORY_CAPTURE_UTC_MINUTE,
  ));
  if (next.getTime() <= now.getTime()) next.setUTCDate(next.getUTCDate() + 1);
  return next.getTime() - now.getTime();
}

function waitFor(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}
