import { ContributionPlanner } from "@/app/plan/contributions/_components/contribution-planner";
import { PageHeader } from "@/components/ui/page-header";
import { getContributionPlannerModel } from "@/features/contributions/read-model";
import { parseContributionQueryAmount } from "@/features/contributions/validation";

export const dynamic = "force-dynamic";

export default async function ContributionsPage({
  searchParams,
}: {
  searchParams: Promise<{ amount?: string | string[] }>;
}) {
  const params = await searchParams;
  const model = await getContributionPlannerModel({ preferredAmount: parseContributionQueryAmount(params.amount) });
  return (
    <>
      <PageHeader title="Plan Contribution" description="Invest new money toward your strategy without selling existing assets." />
      <ContributionPlanner model={model} />
    </>
  );
}
