import { AssistantMessageRole } from "@prisma/client";
import { AssistantRepository } from "@/features/assistant/repository";
import { assistantMessageSchema, type AssistantMessageInput } from "@/features/assistant/validation";

export class AssistantConversationService {
  constructor(private readonly repository = new AssistantRepository()) {}

  async prepareUserMessage(input: AssistantMessageInput) {
    const parsed = assistantMessageSchema.parse(input);
    let conversationId = parsed.conversationId ?? null;

    if (conversationId) {
      const conversation = await this.repository.findConversation(conversationId);
      if (!conversation) throw new Error("Assistant conversation was not found.");
      const latest = await this.repository.findLatestMessage(conversationId);
      if (latest?.role === AssistantMessageRole.USER && latest.content === parsed.message) {
        return { conversationId, message: parsed.message };
      }
    } else {
      const conversation = await this.repository.createConversation(buildConversationTitle(parsed.message));
      conversationId = conversation.id;
    }

    await this.repository.addMessage(conversationId, AssistantMessageRole.USER, parsed.message);
    return { conversationId, message: parsed.message };
  }

  saveAssistantMessage(conversationId: string, content: string) {
    const normalized = content.trim();
    if (!normalized) throw new Error("Assistant returned an empty response.");
    return this.repository.addMessage(conversationId, AssistantMessageRole.ASSISTANT, normalized);
  }

  listRecentMessages(conversationId: string) {
    return this.repository.listRecentMessages(conversationId, 20);
  }
}

export function buildConversationTitle(message: string) {
  const normalized = message.trim().replace(/\s+/g, " ");
  return normalized.length <= 60 ? normalized : `${normalized.slice(0, 57)}…`;
}
