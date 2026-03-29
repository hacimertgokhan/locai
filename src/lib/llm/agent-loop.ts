
import { invoke } from "@tauri-apps/api/core";
import { AgentMessage, AgentStep, LlmStepResult } from "../../types";
import { parseToolCalls, stripToolBlocks } from "./utils";
import { executeToolCall } from "./tool-executor";

export interface AgentCallbacks {
  onStepProgress: (steps: AgentStep[]) => void;
  onNewMessage: (msg: { role: string; content: string; agentSteps?: AgentStep[] }) => void;
  shouldAbort: () => boolean;
}

/**
 * Runs the autonomous agent loop for a given prompt.
 * 
 * @param userPrompt The task the agent should complete.
 * @param workspacePath The current project path.
 * @param systemPrompt The system prompt defining rules/tools (pre-built with skills).
 * @param previousMessages History of the conversation.
 * @param modelInfo LLM provider, model name, and base URL.
 * @param callbacks Callbacks for UI updates and abortion checks.
 */
export async function runAgentLoop(
  userPrompt: string,
  workspacePath: string,
  systemPrompt: string,
  previousMessages: AgentMessage[],
  modelInfo: { provider: string; model: string; baseUrl: string },
  callbacks: AgentCallbacks
) {
  let agentMessages: AgentMessage[] = [
    { role: "system", content: systemPrompt },
    ...previousMessages,
    { role: "user", content: userPrompt },
  ];

  const steps: AgentStep[] = [];
  const MAX_STEPS = 30;

  for (let i = 0; i < MAX_STEPS; i++) {
    if (callbacks.shouldAbort()) {
      callbacks.onNewMessage({
        role: "assistant",
        content: "🛑 Interrupted by user.",
        agentSteps: [...steps]
      });
      return;
    }

    // Call LLM for one step
    const result = await invoke<LlmStepResult>("call_llm_step", {
      provider: modelInfo.provider,
      baseUrl: modelInfo.baseUrl,
      model: modelInfo.model,
      messages: agentMessages,
      tools: [], // tools are described in system prompt
    });

    const rawText = result.type === "content" ? (result.content ?? "") : "";
    const toolCalls = parseToolCalls(rawText);

    if (toolCalls.length > 0) {
      // Add assistant turn to internal message history
      agentMessages.push({ role: "assistant", content: rawText });

      const toolResultLines: string[] = [];

      for (const tc of toolCalls) {
        if (callbacks.shouldAbort()) break;

        const step: AgentStep = {
          id: tc.id,
          tool: tc.name,
          args: tc.args,
          status: "running",
        };
        steps.push(step);
        callbacks.onStepProgress([...steps]);

        // Build a fake call for executor
        const toolResult = await executeToolCall(
          { id: tc.id, type: "function", function: { name: tc.name, arguments: tc.argsRaw } },
          workspacePath
        );

        step.result = toolResult;
        step.status = toolResult.startsWith("Error:") ? "error" : "done";
        callbacks.onStepProgress([...steps]);

        toolResultLines.push(`[${tc.name}] ${toolResult.slice(0, 2000)}`);
      }

      if (callbacks.shouldAbort()) break;

      // Feed results back
      agentMessages.push({
        role: "user",
        content: `Tool results:\n${toolResultLines.join("\n\n")}`,
      });
    } else {
      // Done - strip XML and return final summary
      const summary = stripToolBlocks(rawText);
      callbacks.onNewMessage({
        role: "assistant",
        content: summary || "Task completed.",
        agentSteps: [...steps],
      });
      break;
    }
  }
}
