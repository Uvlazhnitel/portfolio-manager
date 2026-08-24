import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";

export default function PortfolioLoading() {
  return (
    <>
      <PageHeader title="Portfolio" description="Loading portfolio data." />
      <Card>
        <div className="h-64 animate-pulse rounded-lg bg-surface-strong" />
      </Card>
    </>
  );
}
