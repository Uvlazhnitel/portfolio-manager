import { Target } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";

export default function PlanPage() {
  return (
    <>
      <PageHeader title="Plan" description="Strategy targets and contribution planning are grouped here." />
      <EmptyState
        title="Planning workspace"
        description="Use Strategy for target allocation and Contributions for future investment planning."
        icon={<Target className="h-5 w-5" aria-hidden="true" />}
      />
    </>
  );
}
