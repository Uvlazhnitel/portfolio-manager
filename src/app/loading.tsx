import { Card } from "@/components/ui/card";

export default function AppLoading() {
  return (
    <div className="space-y-5" aria-busy="true" aria-label="Loading page">
      <div className="h-9 w-56 animate-pulse rounded-lg bg-surface-raised" />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <Card key={index} className="min-h-36 animate-pulse">
            <div className="h-4 w-24 rounded bg-surface-raised" />
            <div className="mt-5 h-8 w-36 rounded bg-surface-raised" />
          </Card>
        ))}
      </div>
    </div>
  );
}
