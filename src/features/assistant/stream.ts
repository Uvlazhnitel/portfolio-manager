import type OpenAI from "openai";
import type { Responses } from "openai/resources/responses/responses";
import type { AssistantPortfolioRuntime } from "@/features/assistant/context";
import { ASSISTANT_SYSTEM_INSTRUCTIONS } from "@/features/assistant/instructions";
import { assistantToolDefinitions, executeAssistantTool } from "@/features/assistant/tools";
import { publicErrorMessage } from "@/lib/public-error";

export type AssistantStreamEvent =
  | { type: "tool"; name: string }
  | { type: "delta"; text: string };

export async function streamAssistantResponse({
  client,
  model,
  runtime,
  history,
  onEvent,
}: {
  client: OpenAI;
  model: string;
  runtime: AssistantPortfolioRuntime;
  history: Array<{ role: "USER" | "ASSISTANT"; content: string }>;
  onEvent: (event: AssistantStreamEvent) => void;
}) {
  const input: Responses.ResponseInput = [
    {
      role: "developer",
      content: `Trusted deterministic portfolio context (all monetary and percentage values are strings):\n${JSON.stringify(runtime.context)}`,
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
      max_output_tokens: 1200,
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
      if (event.type === "response.failed") throw new Error("OpenAI could not complete the response.");
      if (event.type === "response.incomplete") throw new Error("OpenAI response was incomplete.");
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
        output = await executeAssistantTool(call.name, call.arguments, runtime);
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
