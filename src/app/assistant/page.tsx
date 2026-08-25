import { AssistantClient } from "@/app/assistant/_components/assistant-client";
import { PageHeader } from "@/components/ui/page-header";
import { getAssistantPageModel } from "@/features/assistant/read-model";

export const dynamic = "force-dynamic";

export default async function AssistantPage({
  searchParams,
}: {
  searchParams: Promise<{ conversation?: string | string[] }>;
}) {
  const query = await searchParams;
  const conversationId = typeof query.conversation === "string" ? query.conversation : null;
  const model = await getAssistantPageModel(conversationId);

  return (
    <>
      <PageHeader
        title="Assistant"
        description="Portfolio decision support grounded in deterministic calculations."
      />
      <AssistantClient key={model.selectedConversationId ?? "new"} model={model} />
    </>
  );
}
