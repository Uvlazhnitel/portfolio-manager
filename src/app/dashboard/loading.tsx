import { PageHeader } from "@/components/ui/page-header";

export default function DashboardLoading() {
  return (
    <>
      <PageHeader title="Dashboard" description="Loading portfolio overview." />
      <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1.45fr)_minmax(300px,0.8fr)]" aria-label="Loading dashboard">
        <LoadingPanel className="order-1 h-[360px] xl:col-start-1 xl:row-start-1" />
        <LoadingPanel className="order-2 h-[360px] xl:col-start-2 xl:row-start-2" />
        <LoadingPanel className="order-3 h-[460px] xl:col-start-1 xl:row-start-2" />
        <LoadingPanel className="order-4 h-[360px] xl:col-start-2 xl:row-start-1" />
      </div>
    </>
  );
}

function LoadingPanel({ className }: { className: string }) {
  return <div className={`animate-pulse rounded-lg border border-border bg-card ${className}`} />;
}
