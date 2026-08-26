import { PerformanceClient } from "@/app/performance/_components/performance-client";
import { PageHeader } from "@/components/ui/page-header";
import { getPerformanceReadModel } from "@/features/performance/read-model";

export const dynamic = "force-dynamic";

export default async function PerformancePage() {
  const performance = await getPerformanceReadModel();

  return (
    <>
      <PageHeader
        title="Performance"
        description="Portfolio growth separated from the money you contributed or withdrew."
      />
      <PerformanceClient performance={performance} />
    </>
  );
}
