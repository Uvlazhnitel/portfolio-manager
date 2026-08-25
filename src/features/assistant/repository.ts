import { AssistantMessageRole, type PrismaClient } from "@prisma/client";
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

  findConversation(id: string) {
    return this.db.assistantConversation.findUnique({
      where: { id },
      include: { messages: { orderBy: { createdAt: "asc" } } },
    });
  }

  async listRecentMessages(conversationId: string, limit = 20) {
    const messages = await this.db.assistantMessage.findMany({
      where: { conversationId },
      orderBy: { createdAt: "desc" },
      take: limit,
    });
    return messages.reverse();
  }

  findLatestMessage(conversationId: string) {
    return this.db.assistantMessage.findFirst({
      where: { conversationId },
      orderBy: { createdAt: "desc" },
    });
  }

  createConversation(title: string) {
    return this.db.assistantConversation.create({ data: { title } });
  }

  addMessage(conversationId: string, role: AssistantMessageRole, content: string) {
    return this.db.$transaction(async (transaction) => {
      const message = await transaction.assistantMessage.create({
        data: { conversationId, role, content },
      });
      await transaction.assistantConversation.update({
        where: { id: conversationId },
        data: { updatedAt: new Date() },
      });
      return message;
    });
  }
}
