import Link from "next/link";
import { RefreshCw, ShieldCheck, WifiOff } from "lucide-react";
import { Card } from "@/components/ui/card";

export const metadata = {
  title: "Offline · Portfolio Manager",
};

export default function OfflinePage() {
  return (
    <div className="mx-auto flex min-h-[calc(100dvh-10rem)] max-w-xl items-center justify-center py-8">
      <Card className="w-full border-primary/25 bg-gradient-to-br from-card to-primary/5 p-6 text-center sm:p-8">
        <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-warning/12 text-warning">
          <WifiOff className="h-7 w-7" aria-hidden="true" />
        </span>
        <h1 className="mt-5 text-2xl font-semibold">You&apos;re offline</h1>
        <p className="mt-3 text-sm leading-6 text-muted">
          Portfolio values and market prices are not shown from an offline cache. Reconnect to load current data from the server.
        </p>
        <div className="mt-5 flex items-start gap-3 rounded-lg border border-border bg-surface p-4 text-left">
          <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
          <p className="text-sm leading-6 text-muted">
            This prevents an old portfolio snapshot from looking current while the network is unavailable.
          </p>
        </div>
        <Link
          href="/dashboard"
          className="mt-6 inline-flex min-h-11 items-center justify-center rounded-lg bg-primary px-5 text-sm font-medium text-white shadow-sm shadow-primary/20 hover:bg-primary/90"
        >
          <RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" />
          Try again
        </Link>
      </Card>
    </div>
  );
}
