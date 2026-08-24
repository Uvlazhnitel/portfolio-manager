import { Bot } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";

export default function AssistantPage() {
  return (
    <>
      <PageHeader title="Assistant" description="AI explanations will use already-calculated portfolio data." />
      <EmptyState
        title="Assistant is not wired yet"
        description="The AI layer will explain deterministic engine outputs instead of calculating financial metrics itself."
        icon={<Bot className="h-5 w-5" aria-hidden="true" />}
      />
    </>
  );
}
