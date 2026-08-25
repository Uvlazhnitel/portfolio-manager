import { ScenariosClient } from "@/app/scenarios/_components/scenarios-client";
import { PageHeader } from "@/components/ui/page-header";
import { getScenariosPageModel } from "@/features/scenarios/read-model";

export const dynamic = "force-dynamic";

export default async function ScenariosPage() {
  const model = await getScenariosPageModel();
  return (
    <>
      <PageHeader title="Scenarios" description="Test hypothetical portfolio decisions without changing real data." />
      <ScenariosClient model={model} />
    </>
  );
}
