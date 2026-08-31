import { NextResponse } from "next/server";
import { loadAssistantPortfolioRuntime } from "@/features/assistant/context";
import { createOpenAIClient, getOpenAIConfiguration } from "@/features/assistant/openai";
import { AssistantConversationService } from "@/features/assistant/service";
import { AssistantStreamError, streamAssistantResponse } from "@/features/assistant/stream";
import { assistantMessageSchema } from "@/features/assistant/validation";
import { publicErrorMessage } from "@/lib/public-error";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  const openAIConfiguration = await getOpenAIConfiguration();
  if (!openAIConfiguration.apiKey) {
    return NextResponse.json({
      error: openAIConfiguration.error ?? "Assistant is not configured. Add an OpenAI API key in Settings.",
    }, { status: 503 });
  }

  let rawInput: unknown;
  try {
    rawInput = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }
  const parsed = assistantMessageSchema.safeParse(rawInput);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Assistant message is invalid." }, { status: 400 });
  }

  const service = new AssistantConversationService();
  let prepared: Awaited<ReturnType<AssistantConversationService["prepareUserMessage"]>>;
  try {
    prepared = await service.prepareUserMessage(parsed.data);
  } catch (error) {
    return NextResponse.json({ error: safeErrorMessage(error) }, { status: 400 });
  }

  let runtimeSnapshot: Awaited<ReturnType<typeof loadAssistantPortfolioRuntime>>;
  let history: Awaited<ReturnType<AssistantConversationService["listRecentMessages"]>>;
  try {
    [runtimeSnapshot, history] = await Promise.all([
      loadAssistantPortfolioRuntime(),
      service.listRecentMessages(prepared.conversationId),
    ]);
  } catch (error) {
    await service.failTurn(prepared.userMessageId).catch(() => undefined);
    return NextResponse.json({ error: safeErrorMessage(error) }, { status: 400 });
  }

  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: unknown) => controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      void (async () => {
        try {
          send({ type: "conversation", conversationId: prepared.conversationId, userMessageId: prepared.userMessageId });
          const content = await streamAssistantResponse({
            client: createOpenAIClient(openAIConfiguration.apiKey as string),
            model: openAIConfiguration.model,
            runtime: runtimeSnapshot,
            history: [
              ...history.map((message) => ({ role: message.role, content: message.content })),
              { role: "USER" as const, content: prepared.message },
            ],
            onEvent: send,
          });
          await service.completeTurn(prepared.conversationId, prepared.userMessageId, content);
          send({ type: "done" });
        } catch (error) {
          await service.failTurn(prepared.userMessageId).catch(() => undefined);
          console.error("Assistant request failed", {
            requestId,
            conversationId: prepared.conversationId,
            userMessageId: prepared.userMessageId,
            reasonCode: assistantErrorCode(error),
          });
          send({ type: "error", message: safeErrorMessage(error) });
        } finally {
          controller.close();
        }
      })();
    },
  });

  return new Response(body, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function safeErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : "Assistant request failed.";
  if (/api.?key|401|authentication/i.test(message)) return "OpenAI authentication failed. Check the server API key.";
  if (/rate|429/i.test(message)) return "OpenAI is temporarily rate-limited. Please try again shortly.";
  if (/timeout|network|connection/i.test(message)) return "OpenAI is temporarily unavailable. Please try again.";
  if (error instanceof AssistantStreamError && error.code === "MAX_OUTPUT_TOKENS") return "The response reached its length limit. Please retry.";
  if (error instanceof AssistantStreamError && error.code === "CONTENT_FILTER") return "The response could not be completed safely.";
  return publicErrorMessage(error, "Assistant request failed. Please try again.");
}

function assistantErrorCode(error: unknown) {
  if (error instanceof AssistantStreamError) return error.code;
  const message = error instanceof Error ? error.message : "";
  if (/api.?key|401|authentication/i.test(message)) return "AUTHENTICATION";
  if (/rate|429/i.test(message)) return "RATE_LIMIT";
  if (/timeout|network|connection/i.test(message)) return "NETWORK";
  return "UNKNOWN";
}
