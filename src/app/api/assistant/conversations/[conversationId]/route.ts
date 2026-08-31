import { NextResponse } from "next/server";
import { AssistantConversationService } from "@/features/assistant/service";

export const runtime = "nodejs";

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ conversationId: string }> },
) {
  const { conversationId } = await context.params;
  if (!conversationId || conversationId.length > 64) {
    return NextResponse.json({ error: "Assistant conversation ID is invalid." }, { status: 400 });
  }
  try {
    await new AssistantConversationService().deleteConversation(conversationId);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Assistant conversation was not found." }, { status: 404 });
  }
}
