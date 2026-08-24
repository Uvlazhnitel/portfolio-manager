import { Brain } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";

export default function IntelligencePage() {
  return (
    <>
      <PageHeader title="Intelligence" description="Portfolio insights, drift explanations, and review signals." />
      <EmptyState
        title="Insight layer will come later"
        description="This space is reserved for analysis that explains engine results and decision tradeoffs."
        icon={<Brain className="h-5 w-5" aria-hidden="true" />}
      />
    </>
  );
}
