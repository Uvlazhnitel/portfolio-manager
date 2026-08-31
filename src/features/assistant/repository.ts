import { AssistantMessageRole, AssistantMessageStatus, type PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/db/client";

export class AssistantRepository {
  constructor(private readonly db: PrismaClient = prisma) {}

  listConversations(limit = 10) {
    return this.db.assistantConversation.findMany({
      orderBy: { updatedAt: "desc" },
      take: limit,
      include: { _count: { select: { messages: true } } },
    });
  }

  async findConversation(id: string, messageLimit = 100) {
    const conversation = await this.db.assistantConversation.findUnique({ where: { id } });
    if (!conversation) return null;
    const messages = await this.listConversationMessages(id, messageLimit);
    return { ...conversation, messages };
  }

  async listConversationMessages(conversationId: string, limit = 100) {
    const messages = await this.db.assistantMessage.findMany({
      where: { conversationId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit,
    });
    return messages.reverse();
  }

  async listRecentMessages(conversationId: string, limit = 20) {
    const messages = await this.db.assistantMessage.findMany({
      where: { conversationId, status: AssistantMessageStatus.COMPLETED },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit,
    });
    return messages.reverse();
  }

  async createConversationWithPendingMessage(title: string, content: string) {
    return this.db.$transaction(async (transaction) => {
      const conversation = await transaction.assistantConversation.create({ data: { title } });
      const message = await transaction.assistantMessage.create({
        data: { conversationId: conversation.id, role: AssistantMessageRole.USER, status: AssistantMessageStatus.PENDING, content },
      });
      return { conversation, message };
    });
  }

  addPendingUserMessage(conversationId: string, content: string) {
    return this.db.assistantMessage.create({
      data: { conversationId, role: AssistantMessageRole.USER, status: AssistantMessageStatus.PENDING, content },
    });
  }

  findMessage(id: string) {
    return this.db.assistantMessage.findUnique({ where: { id } });
  }

  retryUserMessage(id: string) {
    return this.db.assistantMessage.update({ where: { id }, data: { status: AssistantMessageStatus.PENDING } });
  }

  failUserMessage(id: string) {
    return this.db.assistantMessage.updateMany({
      where: { id, role: AssistantMessageRole.USER, status: AssistantMessageStatus.PENDING },
      data: { status: AssistantMessageStatus.FAILED },
    });
  }

  completeTurn(conversationId: string, userMessageId: string, content: string) {
    return this.db.$transaction(async (transaction) => {
      const completed = await transaction.assistantMessage.updateMany({
        where: { id: userMessageId, conversationId, role: AssistantMessageRole.USER, status: AssistantMessageStatus.PENDING },
        data: { status: AssistantMessageStatus.COMPLETED },
      });
      if (completed.count !== 1) throw new Error("Assistant request is no longer pending.");
      const message = await transaction.assistantMessage.create({
        data: { conversationId, role: AssistantMessageRole.ASSISTANT, status: AssistantMessageStatus.COMPLETED, content },
      });
      await transaction.assistantConversation.update({ where: { id: conversationId }, data: { updatedAt: new Date() } });
      return message;
    });
  }

  deleteConversation(id: string) {
    return this.db.assistantConversation.delete({ where: { id } });
  }

}
