import { PortfolioReviewView } from "@/app/intelligence/_components/portfolio-review";
import { PageHeader } from "@/components/ui/page-header";
import { getIntelligenceReadModel } from "@/features/intelligence/read-model";

export const dynamic = "force-dynamic";

export default async function IntelligencePage() {
  const intelligence = await getIntelligenceReadModel();

  return (
    <>
      <PageHeader
        title="Intelligence"
        description="What changed in your portfolio, why it matters, and whether it needs your attention."
      />
      <PortfolioReviewView model={intelligence} />
    </>
  );
}
