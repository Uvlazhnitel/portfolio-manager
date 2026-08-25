"use client";

import { AlertTriangle, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export default function AppError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <Card className="mx-auto flex min-h-72 max-w-xl flex-col items-center justify-center text-center">
      <div className="rounded-full border border-warning/30 bg-warning/10 p-3 text-warning">
        <AlertTriangle className="size-6" aria-hidden="true" />
      </div>
      <h1 className="mt-4 text-xl font-semibold text-foreground">This page could not be loaded</h1>
      <p className="mt-2 max-w-md text-sm leading-6 text-muted">
        Your portfolio data was not changed. Check the database connection or try loading the page again.
      </p>
      <Button className="mt-5" onClick={reset}>
        <RotateCcw className="size-4" aria-hidden="true" />
        Try again
      </Button>
    </Card>
  );
}
