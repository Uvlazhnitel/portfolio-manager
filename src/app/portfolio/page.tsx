import { Landmark } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";

export default function PortfolioPage() {
  return (
    <>
      <PageHeader title="Portfolio" description="Positions, instruments, and transaction history will live here." />
      <EmptyState
        title="Portfolio tracking is next"
        description="This foundation is ready for assets, prices, transactions, and deterministic calculations."
        icon={<Landmark className="h-5 w-5" aria-hidden="true" />}
      />
    </>
  );
}
