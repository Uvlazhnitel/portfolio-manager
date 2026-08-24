import { Coins } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";

export default function ScenariosPage() {
  return (
    <>
      <PageHeader title="Scenarios" description="Compare long-term allocation and contribution variants." />
      <EmptyState
        title="Scenario modeling is planned"
        description="Future scenarios will use deterministic calculations and clearly separated assumptions."
        icon={<Coins className="h-5 w-5" aria-hidden="true" />}
      />
    </>
  );
}
