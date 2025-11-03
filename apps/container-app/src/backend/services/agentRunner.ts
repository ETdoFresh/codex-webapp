import { spawn } from "node:child_process";
import * as readline from "node:readline";
import type { TurnItem } from "@codex-webapp/shared";
import { streamChunkToMainApp, postMessageToMainApp } from "./mainAppClient.js";

const WORKSPACE_PATH = process.env.WORKSPACE_PATH || "/workspace";

type AgentProvider = "CodexSDK" | "ClaudeCodeSDK" | "DroidCLI";

type RunAgentOptions = {
  provider: AgentProvider;
  model: string;
  userMessage: string;
  reasoningEffort?: string;
};

// Thread state management
let codexThread: any = null;
let claudeSessionId: string | null = null;
let droidSessionId: string | null = null;

/**
 * Run an agent (Codex/Claude/Droid) and stream output to main app
 */
export async function runAgent(options: RunAgentOptions): Promise<void> {
  const { provider, model, userMessage, reasoningEffort = "medium" } = options;

  console.log(`[Container] Running agent: ${provider} with model ${model}`);

  let assistantContent = "";
  const items: TurnItem[] = [];

  try {
    // Stream chunks as they arrive
    const onContentChunk = (content: string) => {
      assistantContent += content;
      streamChunkToMainApp({
        type: "content",
        content,
      });
    };

    const onItem = (item: TurnItem) => {
      items.push(item);
      streamChunkToMainApp({
        type: "item",
        item,
      });
    };

    // Run the appropriate agent
    switch (provider) {
      case "CodexSDK":
        await runCodexAgent(model, userMessage, reasoningEffort, onContentChunk, onItem);
        break;
      case "ClaudeCodeSDK":
        await runClaudeAgent(model, userMessage, reasoningEffort, onContentChunk, onItem);
        break;
      case "DroidCLI":
        await runDroidAgent(model, userMessage, reasoningEffort, onContentChunk, onItem);
        break;
      default:
        throw new Error(`Unknown provider: ${provider}`);
    }

    // Send complete signal
    streamChunkToMainApp({
      type: "complete",
    });

    // Post final message to main app for persistence
    await postMessageToMainApp({
      role: "assistant",
      content: assistantContent,
      attachments: [],
      items,
      responderProvider: provider,
      responderModel: model,
      responderReasoningEffort: reasoningEffort,
    });

    console.log(`[Container] Agent completed successfully`);
  } catch (error) {
    console.error(`[Container] Agent error:`, error);

    // Post error message
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    await postMessageToMainApp({
      role: "assistant",
      content: `Error: ${errorMessage}`,
      attachments: [],
      items: [{
        type: "error",
        message: errorMessage,
      }],
      responderProvider: provider,
      responderModel: model,
      responderReasoningEffort: reasoningEffort,
    });

    throw error;
  }
}

/**
 * Run Codex SDK agent
 */
async function runCodexAgent(
  model: string,
  userMessage: string,
  _reasoningEffort: string,
  onContent: (content: string) => void,
  onItem: (item: TurnItem) => void,
): Promise<void> {
  try {
    const { Codex } = await import("@openai/codex-sdk");

    const codexOptions = {
      ...(process.env.CODEX_API_KEY ? { apiKey: process.env.CODEX_API_KEY } : {}),
      ...(process.env.CODEX_BASE_URL ? { baseUrl: process.env.CODEX_BASE_URL } : {}),
      ...(process.env.CODEX_PATH ? { codexPathOverride: process.env.CODEX_PATH } : {}),
    };

    const codex = new Codex(codexOptions);

    const sandboxMode = process.platform === 'win32' ? 'danger-full-access' : 'workspace-write' as const;

    const threadOptions: any = {
      sandboxMode,
      workingDirectory: WORKSPACE_PATH,
      skipGitRepoCheck: true,
      ...(model ? { model } : {}),
    };

    // Resume or start thread
    if (codexThread) {
      console.log(`[Container] Resuming Codex thread: ${codexThread.id}`);
    } else {
      codexThread = codex.startThread(threadOptions);
      console.log(`[Container] Started new Codex thread: ${codexThread.id}`);
    }

    // Run streamed
    const result = await (codexThread as any).runStreamed(userMessage);

    // Process events
    for await (const event of result.events) {
      if (event.type === "text") {
        onContent(event.text);
      } else if (event.type === "item") {
        onItem(event.item);
      }
    }

  } catch (error) {
    console.error("[Container] Codex SDK error:", error);
    throw new Error(`Codex SDK error: ${error instanceof Error ? error.message : "Unknown"}`);
  }
}

/**
 * Run Claude SDK agent
 */
async function runClaudeAgent(
  model: string,
  userMessage: string,
  _reasoningEffort: string,
  onContent: (content: string) => void,
  onItem: (item: TurnItem) => void,
): Promise<void> {
  try {
    const { query } = await import("@anthropic-ai/claude-agent-sdk/sdk.mjs");

    const options: any = {
      cwd: WORKSPACE_PATH,
      maxSteps: 100,
      ...(model ? { model } : {}),
      ...(claudeSessionId ? { sessionId: claudeSessionId } : {}),
    };

    console.log(`[Container] Running Claude agent with options:`, options);

    const messages: any[] = [];
    let lastAssistantMessage: any = null;

    // Stream responses
    for await (const message of query(userMessage, options)) {
      messages.push(message);

      if (message.type === "assistant") {
        lastAssistantMessage = message;
        const text = extractClaudeText(message);
        if (text) {
          onContent(text);
        }
      } else if (message.type === "partial_assistant") {
        const text = extractClaudePartialText(message);
        if (text) {
          onContent(text);
        }
      } else if (message.type === "result") {
        // Extract session ID for next turn
        const result = message as any;
        if (result.session_id) {
          claudeSessionId = result.session_id;
        }
      }
    }

    // Create agent message item
    if (lastAssistantMessage) {
      onItem({
        type: "agent_message",
        id: lastAssistantMessage.id || `claude-${Date.now()}`,
        text: extractClaudeText(lastAssistantMessage),
      });
    }

  } catch (error) {
    console.error("[Container] Claude SDK error:", error);
    throw new Error(`Claude SDK error: ${error instanceof Error ? error.message : "Unknown"}`);
  }
}

function extractClaudeText(message: any): string {
  const content = message.message?.content;
  if (!Array.isArray(content)) {
    return "";
  }

  return content
    .map((block) => {
      if (block?.type === "text" && typeof block.text === "string") {
        return block.text;
      }
      return "";
    })
    .filter((text) => text.length > 0)
    .join("");
}

function extractClaudePartialText(partial: any): string | null {
  const event = partial.event;
  if (!event) {
    return null;
  }

  const delta = event.delta;
  if (delta?.text) {
    return delta.text;
  }

  if (event.text) {
    return event.text;
  }

  return null;
}

/**
 * Run Droid CLI agent via subprocess
 */
async function runDroidAgent(
  model: string,
  userMessage: string,
  reasoningEffort: string,
  onContent: (content: string) => void,
  onItem: (item: TurnItem) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const droidPath = process.env.DROID_PATH || "droid";

    const args = ["exec", "--output-format", "debug"];

    // Resume session if available
    if (droidSessionId) {
      args.push("--session-id", droidSessionId);
    }

    if (model) {
      args.push("--model", model);
    }

    if (reasoningEffort) {
      args.push("--reasoning-effort", reasoningEffort);
    }

    // Dangerous mode - allow all file operations
    args.push("--skip-permissions-unsafe");
    args.push("--cwd", WORKSPACE_PATH);
    args.push(userMessage);

    console.log(`[Container] Spawning Droid CLI: ${droidPath}`, args);

    const droid = spawn(droidPath, args, {
      cwd: WORKSPACE_PATH,
      env: {
        ...process.env,
        PWD: WORKSPACE_PATH,
      },
      stdio: ["ignore", "pipe", "pipe"],
      shell: process.platform === "win32",
    });

    let assistantText = "";
    const items: TurnItem[] = [];

    // Parse stdout as JSON debug format
    const rl = readline.createInterface({
      input: droid.stdout!,
      crlfDelay: Infinity,
    });

    rl.on("line", (line) => {
      try {
        const event = JSON.parse(line);

        // Extract session ID
        if (event.session_id || event.sessionId) {
          droidSessionId = event.session_id || event.sessionId;
        }

        // Handle different event types
        if (event.type === "text" && event.text) {
          assistantText += event.text;
          onContent(event.text);
        } else if (event.type === "item" && event.item) {
          items.push(event.item);
          onItem(event.item);
        } else if (event.type === "completion" || event.type === "result") {
          // Final event
          if (event.text) {
            assistantText += event.text;
            onContent(event.text);
          }
        }
      } catch (error) {
        // Not JSON, treat as plain text
        onContent(line + "\n");
      }
    });

    droid.stderr?.on("data", (data) => {
      console.error(`[Container] Droid stderr:`, data.toString());
    });

    droid.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Droid exited with code ${code}`));
      }
    });

    droid.on("error", (error) => {
      reject(error);
    });
  });
}
