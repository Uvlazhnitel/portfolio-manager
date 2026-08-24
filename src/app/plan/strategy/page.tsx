import { PageHeader } from "@/components/ui/page-header";
import { StrategyEditor } from "@/app/plan/strategy/_components/strategy-editor";
import { getStrategyEditorModel } from "@/features/strategy/read-model";

export const dynamic = "force-dynamic";

export default async function StrategyPage() {
  const strategy = await getStrategyEditorModel();

  return (
    <>
      <PageHeader title="Strategy" description={strategy.name} />
      <StrategyEditor key={strategy.updatedAt} strategy={strategy} />
    </>
  );
}
