import { Settings } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";

export default function SettingsPage() {
  return (
    <>
      <PageHeader title="Settings" description="Base currency, data sources, and local preferences." />
      <EmptyState
        title="Settings foundation"
        description="EUR is the default base currency for now; future currencies can be introduced here."
        icon={<Settings className="h-5 w-5" aria-hidden="true" />}
      />
    </>
  );
}
