import { ContributionPlanner } from "@/app/plan/contributions/_components/contribution-planner";
import { PageHeader } from "@/components/ui/page-header";
import { getContributionPlannerModel } from "@/features/contributions/read-model";

export const dynamic = "force-dynamic";

export default async function ContributionsPage() {
  const model = await getContributionPlannerModel();
  return (
    <>
      <PageHeader title="Plan Contribution" description="Invest new money toward your strategy without selling existing assets." />
      <ContributionPlanner model={model} />
    </>
  );
}
