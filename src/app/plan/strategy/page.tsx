import { ChartNoAxesCombined } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";

export default function StrategyPage() {
  return (
    <>
      <PageHeader title="Strategy" description="Configurable target allocation and allowed ranges." />
      <EmptyState
        title="Strategy editor will land here"
        description="Targets will be user-configurable and validated before the portfolio engine uses them."
        icon={<ChartNoAxesCombined className="h-5 w-5" aria-hidden="true" />}
      />
    </>
  );
}
