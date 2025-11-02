import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { Request, Response } from "express";
import type { ThreadItem, Usage } from "@openai/codex-sdk";
import { z } from "zod";
import database from "../db";
import { codexManager } from "../codexManager";
import { claudeManager } from "../claudeManager";
import { getCodexMeta, type CodexProvider } from "../settings";
import {
  allowedImageMimeTypes,
  MAX_ATTACHMENTS_PER_MESSAGE,
  MAX_ATTACHMENT_SIZE_BYTES,
} from "../config/attachments";
import { DEFAULT_SESSION_TITLE } from "../config/sessions";
import { saveAttachmentsToWorkspace } from "../utils/attachments";
import { ensureWorkspaceDirectory } from "../workspaces";
import type { IncomingAttachment, MessageResponse } from "../types/api";
import { messageToResponse, toSessionResponse } from "../types/api";
import type { SessionRecord } from "../types/database";
import { getStreamEventTimeout, recordStreamDebugEvent } from "./streamDebug";
import type IAgent from "../interfaces/IAgent";
import { droidCliManager } from "../droidCliManager";
import { getCopilotCliManager } from "../copilotCliManager";
import { synchronizeUserAuthFiles } from "./userAuthManager";
import { generateCommitMessage } from "./commitMessageService";
import { commitAndPushToGitHub } from "./gitOperationsService";

function getAgentManager(provider: CodexProvider): IAgent {
  switch (provider) {
    case 'CodexSDK':
      return codexManager;
    case 'ClaudeCodeSDK':
      return claudeManager;
    case 'DroidCLI':
      return droidCliManager;
    case 'CopilotCLI':
      return getCopilotCliManager();
    case 'GeminiSDK':
      throw new Error('GeminiSDK provider is not yet implemented');
    default:
      return codexManager;
  }
}

const CODING_AGENT_INSTRUCTIONS = [
  "You are the Codex WebApp agent operating inside a Windows-based workspace.",
  "Prefer editing files by emitting file_change items via apply_patch.",
  'Only run shell commands when absolutely necessary and wrap them exactly as either ["bash","-lc","<command>"] or ["powershell.exe","-NoProfile","-NonInteractive","-Command","<command>"].',
  "Bare powershell.exe commands are not trusted and will be auto-rejected.",
  "If a command is rejected, immediately switch to apply_patch or another allowed approach instead of retrying the same command.",
  "Use workspace-relative paths unless an absolute path is provided.",
].join("\n");

const attachmentSchema = z.object({
  filename: z.string().trim().min(1).max(200),
  mimeType: z.string().trim().min(1).max(120),
  size: z.number().int().min(1),
  base64: z.string().min(1),
});

const messageSchema = z.object({
  content: z.string().trim().max(4000, "Message is too long").optional(),
  attachments: z.array(attachmentSchema).optional(),
});

type ParsedMessagePayload = {
  content: string;
  attachments: IncomingAttachment[];
};

const parseMessagePayload = (req: Request): ParsedMessagePayload => {
  const { content: rawContent, attachments: attachmentsPayload = [] } =
    messageSchema.parse(req.body ?? {});

  return {
    content: rawContent ?? "",
    attachments: attachmentsPayload,
  };
};

const ensureMessagePayloadValid = (payload: ParsedMessagePayload): void => {
  if (payload.content.length === 0 && payload.attachments.length === 0) {
    throw new Error("Provide a message or at least one image attachment.");
  }

  if (payload.attachments.length > MAX_ATTACHMENTS_PER_MESSAGE) {
    throw new Error(
      `You can attach up to ${MAX_ATTACHMENTS_PER_MESSAGE} images per message.`,
    );
  }

  for (const attachment of payload.attachments) {
    if (!allowedImageMimeTypes.has(attachment.mimeType)) {
      throw new Error(`Unsupported image type: ${attachment.mimeType}`);
    }
    if (attachment.size > MAX_ATTACHMENT_SIZE_BYTES) {
      const limitMb = Math.round(MAX_ATTACHMENT_SIZE_BYTES / (1024 * 1024));
      throw new Error(
        `Attachment ${attachment.filename} exceeds the ${limitMb}MB size limit`,
      );
    }
  }
};

export async function handleSessionMessageRequest(
  req: Request,
  res: Response,
  session: SessionRecord,
): Promise<void> {
  const payload = parseMessagePayload(req);

  try {
    ensureMessagePayloadValid(payload);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Invalid message payload.";
    res.status(400).json({ error: message });
    return;
  }

  let savedAttachmentInputs;
  try {
    savedAttachmentInputs = saveAttachmentsToWorkspace(
      session.id,
      payload.attachments,
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to process attachments";
    res.status(400).json({ error: message });
    return;
  }

  const storedContent =
    payload.content.length > 0
      ? payload.content
      : payload.attachments.length > 0
        ? "(Image attachment)"
        : "";

  const userMessage = database.addMessage(
    session.id,
    "user",
    storedContent,
    savedAttachmentInputs,
  );
  const turnMeta = getCodexMeta();
  const agentManager = getAgentManager(turnMeta.provider);
  const responderInfo = {
    provider: turnMeta.provider,
    model: turnMeta.model,
    reasoningEffort: turnMeta.reasoningEffort,
  };

  const workspaceDirectory = ensureWorkspaceDirectory(session.id);
  session.workspacePath = workspaceDirectory;
  const normalizedWorkspaceDirectory = workspaceDirectory.replace(/\\/g, "/");

  if (
    !session.titleLocked &&
    session.title === DEFAULT_SESSION_TITLE &&
    storedContent.length > 0
  ) {
    const inferredTitle =
      storedContent.length > 60
        ? `${storedContent.slice(0, 60).trim()}…`
        : storedContent;
    const updated = database.updateSessionTitle(session.id, inferredTitle);
    if (updated) {
      session.title = updated.title;
      session.updatedAt = updated.updatedAt;
    }
  }

  const userRequest =
    payload.content.length > 0
      ? payload.content
      : userMessage.attachments.length > 0
        ? "The user provided image attachments."
        : "";

  let codexInput =
    `${CODING_AGENT_INSTRUCTIONS}\n\nCurrent workspace directory: ${normalizedWorkspaceDirectory}\n\nUser request:\n${userRequest}`.trimEnd();

  if (userMessage.attachments.length > 0) {
    const attachmentSummary = userMessage.attachments
      .map((attachment, index) => {
        const workspaceRelativePath = attachment.relativePath;
        const absolutePath = path
          .resolve(workspaceDirectory, attachment.relativePath)
          .replace(/\\/g, "/");
        return `${index + 1}. ${attachment.filename} (workspace path: ${workspaceRelativePath}; absolute path: ${absolutePath})`;
      })
      .join("\n");
    codexInput += `\n\nAttachments:\n${attachmentSummary}`;
  }

  res.status(201);
  res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();

  const streamDebugLogPath = path.join(
    workspaceDirectory,
    ".codex",
    "logs",
    `${session.id}-stream-debug.log`,
  );
  fs.mkdirSync(path.dirname(streamDebugLogPath), { recursive: true });
  const appendDebugLog = (entry: unknown) => {
    try {
      const serialized =
        typeof entry === "string" ? entry : JSON.stringify(entry);
      fs.appendFileSync(
        streamDebugLogPath,
        `[${new Date().toISOString()}] ${session.id} ${serialized}\n`,
      );
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error("[stream] failed to write debug log", error);
    }
  };

  let clientAborted = false;
  let responseFinished = false;
  let stopIterator: (() => void) | null = null;

  const stopStreamIterator = () => {
    if (!stopIterator) {
      return;
    }
    const stopper = stopIterator;
    stopIterator = null;
    try {
      stopper();
    } catch (error) {
      appendDebugLog({
        type: "iterator_stop_failed",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };

  req.on("aborted", () => {
    clientAborted = true;
    appendDebugLog({ type: "client_aborted" });
    stopStreamIterator();
  });
  res.on("finish", () => {
    responseFinished = true;
    appendDebugLog({ type: "response_finished" });
  });
  req.on("close", () => {
    if (!responseFinished && !res.writableEnded) {
      appendDebugLog({ type: "client_closed_before_finish" });
    } else {
      appendDebugLog({ type: "client_closed_after_finish" });
    }
    if (!responseFinished) {
      stopStreamIterator();
    }
  });

  const writeEvent = (event: unknown) => {
    recordStreamDebugEvent({
      sessionId: session.id,
      type: (event as { type?: unknown })?.type,
    });
    appendDebugLog(event);
    if (res.writableEnded) {
      return;
    }
    res.write(`${JSON.stringify(event)}\n`);
    const flush = (res as Response & { flush?: () => void }).flush;
    flush?.call(res);
  };

  const userMessagePayload = messageToResponse(userMessage);
  writeEvent({ type: "user_message", message: userMessagePayload });

  const assistantTemporaryId = `temp-${randomUUID()}`;
  const assistantCreatedAt = new Date().toISOString();

  const itemOrder: string[] = [];
  const itemMap = new Map<string, ThreadItem>();
  const completedItems: ThreadItem[] = [];
  let assistantText = "";
  let usage: Usage | null = null;
  let streamError: Error | null = null;

  const snapshotItems = (): ThreadItem[] =>
    itemOrder
      .map((id) => itemMap.get(id))
      .filter((item): item is ThreadItem => item !== undefined);

  const sendSnapshot = () => {
    const snapshot: MessageResponse = {
      id: assistantTemporaryId,
      role: "assistant",
      content: assistantText,
      createdAt: assistantCreatedAt,
      attachments: [],
      items: snapshotItems(),
      responderProvider: responderInfo.provider,
      responderModel: responderInfo.model,
      responderReasoningEffort: responderInfo.reasoningEffort,
    };
    writeEvent({ type: "assistant_message_snapshot", message: snapshot });
  };

  const handleItemEvent = (item: ThreadItem) => {
    const typed = item as { id?: string; type?: string; text?: unknown };
    const id = typed.id;
    if (!id) {
      return;
    }

    if (!itemOrder.includes(id)) {
      itemOrder.push(id);
    }

    itemMap.set(id, item);
    if (typed.type === "agent_message" && typeof typed.text === "string") {
      assistantText = typed.text;
    }
  };

  sendSnapshot();

  try {
    if (!session.userId) {
      res.status(500).json({ error: "Session missing owner" });
      return;
    }

    const authContext = synchronizeUserAuthFiles(session.userId);
    const { events } = await agentManager.runTurnStreamed(
      session,
      codexInput,
      {
        env: authContext.env,
      },
    );
    const iterator = events[Symbol.asyncIterator]();

    stopIterator = () => {
      if (typeof iterator.return === "function") {
        iterator.return(undefined).catch(() => {
          // Swallow return errors; iterator is best-effort stopped.
        });
      }
    };

    const baseTimeoutMs = getStreamEventTimeout();
    const postResponseTimeoutMs = Math.min(baseTimeoutMs, 5000);
    let agentResponseCompleted = false;

    const timeoutSymbol = Symbol("stream timeout");

    const nextEvent = async (): Promise<
      IteratorResult<unknown, unknown> | typeof timeoutSymbol
    > => {
      let timer: NodeJS.Timeout | null = null;
      const waitMs = agentResponseCompleted ? postResponseTimeoutMs : baseTimeoutMs;
      const timeoutPromise = new Promise<typeof timeoutSymbol>((resolve) => {
        timer = setTimeout(() => resolve(timeoutSymbol), waitMs);
      });
      const result = await Promise.race([iterator.next(), timeoutPromise]);
      if (timer) {
        clearTimeout(timer);
      }
      return result;
    };

    while (!clientAborted) {
      const result = await nextEvent();
      if (result === timeoutSymbol) {
        if (agentResponseCompleted) {
          break;
        }
        const message = `Codex stream stalled after ${getStreamEventTimeout()}ms without new events.`;
        streamError = new Error(message);
        break;
      }

      if (result.done) {
        break;
      }

      const event = result.value as { type?: string };

      // Handle thread/session initialization for both Codex and Claude
      if (event.type === "thread.started" || event.type === "session.started") {
        const typedEvent = result.value as {
          type: "thread.started" | "session.started";
          thread_id?: string;
          session_id?: string;
        };
        const threadOrSessionId = typedEvent.thread_id ?? typedEvent.session_id;
        if (
          threadOrSessionId &&
          session.codexThreadId !== threadOrSessionId
        ) {
          const updated = database.updateSessionThreadId(
            session.id,
            threadOrSessionId,
          );
          if (updated) {
            session.codexThreadId = updated.codexThreadId;
            session.updatedAt = updated.updatedAt;
          }
        }
        continue;
      }

      if (
        event.type === "item.started" ||
        event.type === "item.updated" ||
        event.type === "item.completed"
      ) {
        const typedEvent = result.value as { item: ThreadItem; type: string };
        handleItemEvent(typedEvent.item);
        if (event.type === "item.completed") {
          completedItems.push(typedEvent.item);
          if (typedEvent.item.type === "agent_message") {
            agentResponseCompleted = true;
          }
        }
        sendSnapshot();
        continue;
      }

      if (event.type === "turn.completed") {
        const typedEvent = result.value as {
          type: "turn.completed";
          usage: Usage;
        };
        usage = typedEvent.usage;
        agentResponseCompleted = true;
        continue;
      }

      if (event.type === "turn.failed") {
        const typedEvent = result.value as {
          type: "turn.failed";
          error?: { message?: string };
        };
        streamError = new Error(
          typedEvent.error?.message ?? "Codex turn failed",
        );
        break;
      }

      if (event.type === "error") {
        const typedEvent = result.value as { type: "error"; message?: string };
        streamError = new Error(typedEvent.message ?? "Codex stream error");
        break;
      }

      if (event.type === "response.output_text.delta") {
        const typedEvent = result.value as {
          type: "response.output_text.delta";
          delta: string;
        };
        assistantText += typedEvent.delta;
        sendSnapshot();
        continue;
      }

      if (event.type === "response.completed") {
        const typedEvent = result.value as {
          type: "response.completed";
          output: { text: string }[];
        };
        assistantText = typedEvent.output?.[0]?.text ?? assistantText;
        sendSnapshot();
        agentResponseCompleted = true;
        continue;
      }

      writeEvent(result.value);
    }
  } catch (error) {
    streamError =
      error instanceof Error ? error : new Error("Codex execution failed");
  } finally {
    stopStreamIterator();
  }

  const hasAssistantContent =
    assistantText.trim().length > 0 || completedItems.length > 0;

  if (streamError && !hasAssistantContent) {
    agentManager.forgetSession(session.id);
    if (session.codexThreadId) {
      database.updateSessionThreadId(session.id, null);
      session.codexThreadId = null;
    }
    writeEvent({
      type: "error",
      message: streamError.message,
      temporaryId: assistantTemporaryId,
    });
    writeEvent({ type: "done" });
    if (!clientAborted && !res.writableEnded) {
      res.end();
    }
    return;
  }

  const assistantMessage = database.addMessage(
    session.id,
    "assistant",
    assistantText,
    [],
    completedItems,
    responderInfo,
  );
  const latestSession = database.getSession(session.id) ?? session;

  writeEvent({
    type: "assistant_message_final",
    temporaryId: assistantTemporaryId,
    message: messageToResponse(assistantMessage),
    session: toSessionResponse(latestSession),
    usage,
  });

  // Auto-commit if enabled
  const settings = database.getSessionSettings(session.id);
  if (settings?.autoCommit && session.userId) {
    void (async () => {
      try {
        console.log(`[auto-commit] Starting auto-commit for session ${session.id}`);

        const commitMessage = await generateCommitMessage(session);
        if (!commitMessage) {
          console.log(`[auto-commit] No commit message generated (no changes or not a git repo)`);
          return;
        }

        console.log(`[auto-commit] Generated commit message: ${commitMessage.split('\n')[0]}`);

        const result = await commitAndPushToGitHub(
          session.id,
          session.userId,
          commitMessage,
        );

        if (result.success) {
          console.log(`[auto-commit] Successfully committed: ${result.commitSha}`);
        } else {
          console.error(`[auto-commit] Failed: ${result.error}`);
        }
      } catch (error) {
        console.error('[auto-commit] Error during auto-commit:', error);
      }
    })();
  }

  if (streamError) {
    agentManager.forgetSession(session.id);
    if (session.codexThreadId) {
      database.updateSessionThreadId(session.id, null);
      session.codexThreadId = null;
    }
    writeEvent({
      type: "error",
      message: streamError.message,
      temporaryId: assistantTemporaryId,
    });
  }

  writeEvent({ type: "done" });
  const endedByServer = !res.writableEnded;
  if (endedByServer) {
    res.end();
  }
  appendDebugLog({ type: "server_closed", clientAborted, endedByServer });
}
