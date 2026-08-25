import { AssistantRepository } from "@/features/assistant/repository";

export type AssistantPageModel = {
  isConfigured: boolean;
  model: string;
  selectedConversationId: string | null;
  conversations: Array<{ id: string; title: string; updatedAt: string; messageCount: number }>;
  messages: Array<{ id: string; role: "USER" | "ASSISTANT"; content: string; createdAt: string }>;
};

export async function getAssistantPageModel(
  conversationId: string | null,
  repository = new AssistantRepository(),
): Promise<AssistantPageModel> {
  const conversations = await repository.listConversations(10);
  let selectedId = conversationId ?? conversations[0]?.id ?? null;
  let selected = selectedId ? await repository.findConversation(selectedId) : null;
  if (!selected && conversations[0]) {
    selectedId = conversations[0].id;
    selected = await repository.findConversation(selectedId);
  }

  return {
    isConfigured: Boolean(process.env.OPENAI_API_KEY?.trim()),
    model: process.env.OPENAI_MODEL?.trim() || "gpt-5-mini",
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
      content: message.content,
      createdAt: message.createdAt.toISOString(),
    })) ?? [],
  };
}
