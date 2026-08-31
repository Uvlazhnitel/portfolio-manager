import { describe, expect, it, vi } from "vitest";

vi.mock("@/features/integrations/service", () => ({
  resolveOpenAIConfiguration: vi.fn(async () => ({ apiKey: "configured", model: "gpt-5-mini" })),
}));

import { getAssistantPageModel } from "@/features/assistant/read-model";
import type { AssistantRepository } from "@/features/assistant/repository";

describe("assistant page selection", () => {
  it("keeps an explicit new chat blank when previous conversations exist", async () => {
    const repository = {
      listConversations: vi.fn(async () => [{
        id: "existing",
        title: "Existing conversation",
        createdAt: new Date("2026-08-01T00:00:00Z"),
        updatedAt: new Date("2026-08-02T00:00:00Z"),
        _count: { messages: 2 },
      }]),
      findConversation: vi.fn(async () => { throw new Error("Explicit new chat must not load an old conversation."); }),
    } as unknown as AssistantRepository;

    const model = await getAssistantPageModel(null, true, repository);
    expect(model.selectedConversationId).toBeNull();
    expect(model.messages).toEqual([]);
    expect(model.conversations).toHaveLength(1);
    expect(repository.findConversation).not.toHaveBeenCalled();
  });
});
