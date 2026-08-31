import { AssistantRepository } from "@/features/assistant/repository";
import { STALE_PENDING_AFTER_MS } from "@/features/assistant/service";
import { resolveOpenAIConfiguration } from "@/features/integrations/service";

export type AssistantPageModel = {
  isConfigured: boolean;
  model: string;
  selectedConversationId: string | null;
  conversations: Array<{ id: string; title: string; updatedAt: string; messageCount: number }>;
  messages: Array<{ id: string; role: "USER" | "ASSISTANT"; status: "PENDING" | "COMPLETED" | "FAILED"; content: string; createdAt: string; retryable: boolean }>;
};

export async function getAssistantPageModel(
  conversationId: string | null,
  newChat = false,
  repository = new AssistantRepository(),
): Promise<AssistantPageModel> {
  const [conversations, openAIConfiguration] = await Promise.all([
    repository.listConversations(10),
    resolveOpenAIConfiguration(),
  ]);
  let selectedId = newChat ? null : conversationId ?? conversations[0]?.id ?? null;
  let selected = selectedId ? await repository.findConversation(selectedId) : null;
  if (!newChat && !selected && conversations[0]) {
    selectedId = conversations[0].id;
    selected = await repository.findConversation(selectedId);
  }

  return {
    isConfigured: Boolean(openAIConfiguration.apiKey),
    model: openAIConfiguration.model,
    selectedConversationId: selected?.id ?? null,
    conversations: conversations.map((conversation) => ({
      id: conversation.id,
      title: conversation.title,
      updatedAt: conversation.updatedAt.toISOString(),
      messageCount: conversation._count.messages,
    })),
    messages: selected?.messages.map((message) => ({
      id: message.id,
      role: message.role,
      status: message.status,
      content: message.content,
      createdAt: message.createdAt.toISOString(),
      retryable: message.status === "FAILED" ||
        (message.status === "PENDING" && Date.now() - message.createdAt.getTime() >= STALE_PENDING_AFTER_MS),
    })) ?? [],
  };
}
