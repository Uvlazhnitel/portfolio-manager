import { PiggyBank } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";

export default function ContributionsPage() {
  return (
    <>
      <PageHeader title="Contributions" description="Plan future investments without assuming forced selling." />
      <EmptyState
        title="Contribution planner is queued"
        description="This page will suggest future buys that move allocation toward target ranges."
        icon={<PiggyBank className="h-5 w-5" aria-hidden="true" />}
      />
    </>
  );
}
