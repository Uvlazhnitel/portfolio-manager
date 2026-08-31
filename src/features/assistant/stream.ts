import type OpenAI from "openai";
import type { Responses } from "openai/resources/responses/responses";
import type { AssistantPortfolioRuntime } from "@/features/assistant/context";
import { ASSISTANT_SYSTEM_INSTRUCTIONS } from "@/features/assistant/instructions";
import { assistantToolDefinitions, executeAssistantTool } from "@/features/assistant/tools";
import { createAssistantToolServices, type AssistantToolServices } from "@/features/assistant/tool-services";
import { publicErrorMessage } from "@/lib/public-error";

export type AssistantStreamEvent =
  | { type: "tool"; name: string }
  | { type: "delta"; text: string };

export type AssistantStreamErrorCode =
  | "MAX_OUTPUT_TOKENS"
  | "CONTENT_FILTER"
  | "PROVIDER_FAILED"
  | "PROVIDER_INCOMPLETE";

export class AssistantStreamError extends Error {
  constructor(public readonly code: AssistantStreamErrorCode, message: string) {
    super(message);
    this.name = "AssistantStreamError";
  }
}

export async function streamAssistantResponse({
  client,
  model,
  runtime,
  history,
  onEvent,
  toolServices = createAssistantToolServices(),
}: {
  client: OpenAI;
  model: string;
  runtime: AssistantPortfolioRuntime;
  history: Array<{ role: "USER" | "ASSISTANT"; content: string }>;
  onEvent: (event: AssistantStreamEvent) => void;
  toolServices?: AssistantToolServices;
}) {
  const bootstrapContext = {
    baseCurrency: runtime.context.baseCurrency,
    strategyConfigured: runtime.context.strategy !== null,
    marketData: runtime.context.marketData,
    availableDeterministicTools: assistantToolDefinitions.flatMap((tool) => "name" in tool ? [tool.name] : []),
  };
  const input: Responses.ResponseInput = [
    {
      role: "developer",
      content: `Trusted Assistant bootstrap context. Fetch all authoritative portfolio facts with the matching deterministic tool. Monetary and percentage values returned by tools are strings:\n${JSON.stringify(bootstrapContext)}`,
    },
    ...history.map((message) => ({
      role: message.role === "USER" ? "user" as const : "assistant" as const,
      content: message.content,
    })),
  ];
  let completeText = "";

  for (let round = 0; round < 5; round += 1) {
    const stream = await client.responses.create({
      model,
      instructions: ASSISTANT_SYSTEM_INSTRUCTIONS,
      input,
      tools: assistantToolDefinitions,
      tool_choice: "auto",
      parallel_tool_calls: false,
      reasoning: { effort: "low" },
      text: { verbosity: "low" },
      max_output_tokens: 3000,
      store: false,
      stream: true,
    });
    let completedResponse: Responses.Response | null = null;

    for await (const event of stream) {
      if (event.type === "response.output_text.delta") {
        completeText += event.delta;
        onEvent({ type: "delta", text: event.delta });
      }
      if (event.type === "response.completed") completedResponse = event.response;
      if (event.type === "response.failed") {
        throw new AssistantStreamError("PROVIDER_FAILED", "OpenAI could not complete the response.");
      }
      if (event.type === "response.incomplete") {
        const reason = event.response.incomplete_details?.reason;
        if (reason === "max_output_tokens") {
          throw new AssistantStreamError("MAX_OUTPUT_TOKENS", "OpenAI reached the response limit.");
        }
        if (reason === "content_filter") {
          throw new AssistantStreamError("CONTENT_FILTER", "OpenAI could not complete this response safely.");
        }
        throw new AssistantStreamError("PROVIDER_INCOMPLETE", "OpenAI response was incomplete.");
      }
    }

    if (!completedResponse) throw new Error("OpenAI stream ended before completion.");
    const toolCalls = completedResponse.output.filter(
      (item): item is Responses.ResponseFunctionToolCall => item.type === "function_call",
    );
    const replayItems = completedResponse.output.filter(
      (item): item is Responses.ResponseOutputMessage | Responses.ResponseFunctionToolCall | Responses.ResponseReasoningItem =>
        item.type === "message" || item.type === "function_call" || item.type === "reasoning",
    );
    input.push(...replayItems);

    if (toolCalls.length === 0) {
      if (!completeText.trim()) throw new Error("OpenAI returned an empty response.");
      return completeText.trim();
    }

    for (const call of toolCalls) {
      onEvent({ type: "tool", name: call.name });
      let output: unknown;
      try {
        output = await executeAssistantTool(call.name, call.arguments, runtime, toolServices);
      } catch (error) {
        output = { error: publicErrorMessage(error, "Tool execution failed.") };
      }
      input.push({
        type: "function_call_output",
        call_id: call.call_id,
        output: JSON.stringify(output),
      });
    }
  }

  throw new Error("Assistant exceeded the maximum number of tool calls.");
}
