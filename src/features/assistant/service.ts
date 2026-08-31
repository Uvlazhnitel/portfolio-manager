import { AssistantMessageRole, AssistantMessageStatus } from "@prisma/client";
import { AssistantRepository } from "@/features/assistant/repository";
import { assistantMessageSchema, type AssistantMessageInput } from "@/features/assistant/validation";

export class AssistantConversationService {
  constructor(private readonly repository = new AssistantRepository()) {}

  async prepareUserMessage(input: AssistantMessageInput) {
    const parsed = assistantMessageSchema.parse(input);
    if (parsed.retryMessageId) {
      const existing = await this.repository.findMessage(parsed.retryMessageId);
      if (!existing || existing.conversationId !== parsed.conversationId || existing.role !== AssistantMessageRole.USER) {
        throw new Error("Assistant message was not found in this conversation.");
      }
      const stalePending = existing.status === AssistantMessageStatus.PENDING &&
        Date.now() - existing.createdAt.getTime() >= STALE_PENDING_AFTER_MS;
      if (existing.status !== AssistantMessageStatus.FAILED && !stalePending) {
        throw new Error("Only failed or interrupted messages can be retried.");
      }
      const message = await this.repository.retryUserMessage(existing.id);
      return { conversationId: existing.conversationId, userMessageId: message.id, message: message.content };
    }

    if (parsed.conversationId) {
      const conversation = await this.repository.findConversation(parsed.conversationId);
      if (!conversation) throw new Error("Assistant conversation was not found.");
      const message = await this.repository.addPendingUserMessage(conversation.id, parsed.message);
      return { conversationId: conversation.id, userMessageId: message.id, message: message.content };
    }

    const created = await this.repository.createConversationWithPendingMessage(buildConversationTitle(parsed.message), parsed.message);
    return { conversationId: created.conversation.id, userMessageId: created.message.id, message: created.message.content };
  }

  completeTurn(conversationId: string, userMessageId: string, content: string) {
    const normalized = content.trim();
    if (!normalized) throw new Error("Assistant returned an empty response.");
    return this.repository.completeTurn(conversationId, userMessageId, normalized);
  }

  failTurn(userMessageId: string) {
    return this.repository.failUserMessage(userMessageId);
  }

  listRecentMessages(conversationId: string) {
    return this.repository.listRecentMessages(conversationId, 20);
  }

  async deleteConversation(conversationId: string) {
    const conversation = await this.repository.findConversation(conversationId, 1);
    if (!conversation) throw new Error("Assistant conversation was not found.");
    await this.repository.deleteConversation(conversationId);
  }
}

export const STALE_PENDING_AFTER_MS = 5 * 60 * 1000;

export function buildConversationTitle(message: string) {
  const normalized = message.trim().replace(/\s+/g, " ");
  return normalized.length <= 60 ? normalized : `${normalized.slice(0, 57)}…`;
}
