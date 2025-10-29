import { randomUUID } from 'node:crypto';
import { query, type SDKMessage, type Options } from '@anthropic-ai/claude-agent-sdk/sdk.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ThreadItem, Usage } from '@openai/codex-sdk';
import type {
  SDKResultMessage,
  SDKAssistantMessage,
  SDKPartialAssistantMessage,
} from './types/claude';
import type { SessionRecord } from './types/database';
import { ensureWorkspaceDirectory } from './workspaces';
import { getCodexMeta } from './settings';
import type IAgent from './interfaces/IAgent';
import type { AgentRunOptions } from './interfaces/IAgent';
import type { CodexThreadEvent, RunTurnResult, RunTurnStreamedResult } from './types/codex';

type SessionCacheEntry = {
  claudeSessionId: string | null;
  lastAssistantMessageId: string | null;
};

const dirname = path.dirname(fileURLToPath(import.meta.url));

class ClaudeManager implements IAgent {
  private readonly sessions: Map<string, SessionCacheEntry>;

  constructor() {
    this.sessions = new Map();
  }

  private applyEnv(env: AgentRunOptions['env']): () => void {
    if (!env || Object.keys(env).length === 0) {
      return () => {};
    }

    const previous = new Map<string, string | undefined>();
    for (const [key, value] of Object.entries(env)) {
      previous.set(key, process.env[key]);
      process.env[key] = value;
    }

    return () => {
      for (const [key, value] of previous.entries()) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
    };
  }

  private async withEnv<T>(env: AgentRunOptions['env'], fn: () => Promise<T>): Promise<T> {
    const restore = this.applyEnv(env);
    try {
      return await fn();
    } finally {
      restore();
    }
  }

  private wrapGeneratorWithEnv<T>(
    env: AgentRunOptions['env'],
    generator: AsyncGenerator<T>,
  ): AsyncGenerator<T> {
    if (!env || Object.keys(env).length === 0) {
      return generator;
    }

    const self = this;
    return (async function* wrapped() {
      const restore = self.applyEnv(env);
      try {
        for await (const item of generator) {
          yield item;
        }
      } finally {
        restore();
      }
    })();
  }

  private getSessionFromCache(sessionKey: string): SessionCacheEntry | null {
    return this.sessions.get(sessionKey) ?? null;
  }

  private setSessionCache(
    sessionKey: string,
    claudeSessionId: string | null,
    lastAssistantMessageId: string | null,
  ) {
    this.sessions.set(sessionKey, {
      claudeSessionId,
      lastAssistantMessageId,
    });
  }

  private extractAssistantText(message: SDKAssistantMessage): string {
    const content = (message.message as { content?: unknown })?.content;
    if (!Array.isArray(content)) {
      return '';
    }

    return content
      .map((block) => {
        if (
          block &&
          typeof block === 'object' &&
          (block as { type?: unknown }).type === 'text' &&
          typeof (block as { text?: unknown }).text === 'string'
        ) {
          return (block as { text: string }).text;
        }
        return '';
      })
      .filter((text) => text.length > 0)
      .join('');
  }

  private extractPartialText(partial: SDKPartialAssistantMessage): string | null {
    const event = partial.event as Record<string, unknown> | undefined;
    if (!event) {
      return null;
    }

    const delta = event.delta as Record<string, unknown> | undefined;
    if (delta) {
      if (typeof delta.text === 'string') {
        return delta.text;
      }
      if (
        typeof delta.type === 'string' &&
        delta.type === 'text_delta' &&
        typeof delta.text === 'string'
      ) {
        return delta.text;
      }
    }

    if (typeof (event as { text?: unknown }).text === 'string') {
      return (event as { text: string }).text;
    }

    return null;
  }

  private createAgentMessageItem(id: string, text: string): ThreadItem {
    return {
      id,
      type: 'agent_message',
      text,
    };
  }

  private normalizeClaudeError(error: unknown): string {
    const message =
      error instanceof Error
        ? error.message
        : typeof error === 'string'
          ? error
          : 'Claude Code execution failed';

    if (typeof message === 'string' && message.toLowerCase().includes('exited with code 1')) {
      return 'Claude Code exited with status 1. Verify your local Claude CLI session or usage limits.';
    }

    return message;
  }

  private createQueryOptions(
    workspaceDirectory: string,
    resumeSessionId?: string | null,
    resumeAt?: string | null,
  ): Options {
    const { model } = getCodexMeta();

    const options: Options = {
      cwd: workspaceDirectory,
      includePartialMessages: true,
      permissionMode: 'acceptEdits',
      systemPrompt: {
        type: 'preset',
        preset: 'claude_code',
      },
    };

    if (resumeSessionId) {
      options.resume = resumeSessionId;
      if (resumeAt) {
        options.resumeSessionAt = resumeAt;
      }
    }

    if (model) {
      options.model = model;
    }

    if (process.env.CLAUDE_PATH) {
      options.pathToClaudeCodeExecutable = process.env.CLAUDE_PATH;
    }

    return options;
  }

  private async* mapClaudeEvents(
    sessionKey: string,
    messages: AsyncGenerator<SDKMessage>,
  ): AsyncGenerator<CodexThreadEvent> {
    const cached = this.getSessionFromCache(sessionKey);
    let claudeSessionId = cached?.claudeSessionId ?? null;
    let lastAssistantMessageId = cached?.lastAssistantMessageId ?? null;
    let threadStarted = false;
    let assistantText = '';
    let itemStarted = false;
    let itemId: string | null = lastAssistantMessageId ?? null;
    let turnStarted = false;

    if (claudeSessionId) {
      threadStarted = true;
      yield { type: 'thread.started', thread_id: claudeSessionId };
    }

    if (!turnStarted) {
      turnStarted = true;
      yield { type: 'turn.started' };
    }

    const ensureItemId = (preferred?: string | null) => {
      if (preferred && preferred.trim().length > 0) {
        itemId = preferred;
      }
      if (!itemId) {
        itemId = randomUUID();
      }
      return itemId;
    };

    try {
      for await (const message of messages) {
        if (message.session_id) {
          const incomingSessionId = message.session_id;
          if (!claudeSessionId || claudeSessionId !== incomingSessionId) {
            claudeSessionId = incomingSessionId;
            this.setSessionCache(sessionKey, claudeSessionId, lastAssistantMessageId);
          }
          if (!threadStarted && claudeSessionId) {
            threadStarted = true;
            yield { type: 'thread.started', thread_id: claudeSessionId };
          }
        }

        if (message.type === 'stream_event') {
          const delta = this.extractPartialText(message);
          if (!delta) {
            continue;
          }

          assistantText += delta;
          const resolvedItemId =
            ensureItemId(
              (message.event as { message_id?: string } | undefined)?.message_id ?? message.uuid,
            );
          const item = this.createAgentMessageItem(resolvedItemId, assistantText);
          if (!itemStarted) {
            itemStarted = true;
            yield { type: 'item.started', item };
          } else {
            yield { type: 'item.updated', item };
          }
          continue;
        }

        if (message.type === 'assistant') {
          const resolvedItemId = ensureItemId(message.message.id ?? message.uuid);
          const finalText = this.extractAssistantText(message);
          if (finalText.length > 0) {
            assistantText = finalText;
          }
          const item = this.createAgentMessageItem(resolvedItemId, assistantText);
          if (!itemStarted) {
            itemStarted = true;
            yield { type: 'item.started', item };
          } else {
            yield { type: 'item.updated', item };
          }
          yield { type: 'item.completed', item };
          lastAssistantMessageId = message.message.id ?? null;
          this.setSessionCache(sessionKey, claudeSessionId, lastAssistantMessageId);
          continue;
        }

        if (message.type === 'result') {
          const resultMessage = message as SDKResultMessage;
          if (resultMessage.subtype === 'success') {
            yield { type: 'turn.completed', usage: resultMessage.usage as unknown as Usage };
          } else {
            yield {
              type: 'turn.failed',
              error: { message: `Claude turn ${resultMessage.subtype}` },
            };
          }
          continue;
        }
      }
    } catch (error) {
      const normalized = this.normalizeClaudeError(error);
      yield { type: 'turn.failed', error: { message: normalized } };
      return;
    }
  }

  async runTurn(
    session: SessionRecord,
    input: string,
    options: AgentRunOptions = {},
  ): Promise<RunTurnResult> {
    return this.withEnv(options.env, async () => {
      const workspaceDirectory = ensureWorkspaceDirectory(session.id);
      const cached = this.getSessionFromCache(session.id);
      const resumeSessionId = session.codexThreadId ?? cached?.claudeSessionId ?? null;
      const resumeAt = cached?.lastAssistantMessageId ?? null;

      const queryOptions = this.createQueryOptions(workspaceDirectory, resumeSessionId, resumeAt);
      const queryInstance = query({ prompt: input, options: queryOptions });

      let resultMessage: SDKResultMessage | null = null;
      let claudeSessionId = resumeSessionId;
      let lastAssistantMessageId = resumeAt;

      try {
        for await (const message of queryInstance) {
          if (message.session_id && message.session_id !== claudeSessionId) {
            claudeSessionId = message.session_id;
          }

          if (message.type === 'assistant') {
            lastAssistantMessageId = message.message.id ?? lastAssistantMessageId;
          }

          if (message.type === 'result') {
            resultMessage = message as SDKResultMessage;
          }
        }
      } catch (error) {
        throw new Error(this.normalizeClaudeError(error));
      }

      this.setSessionCache(session.id, claudeSessionId ?? null, lastAssistantMessageId ?? null);

      if (!resultMessage) {
        throw new Error('Claude run did not produce a result.');
      }

      return {
        result: resultMessage as any,
        threadId: claudeSessionId ?? null,
      };
    });
  }

  async runTurnStreamed(
    session: SessionRecord,
    input: string,
    options: AgentRunOptions = {},
  ): Promise<RunTurnStreamedResult> {
    const generator = await this.withEnv(options.env, async () => {
      const workspaceDirectory = ensureWorkspaceDirectory(session.id);
      const cached = this.getSessionFromCache(session.id);
      const resumeSessionId = session.codexThreadId ?? cached?.claudeSessionId ?? null;
      const resumeAt = cached?.lastAssistantMessageId ?? null;

      const queryOptions = this.createQueryOptions(workspaceDirectory, resumeSessionId, resumeAt);
      const queryInstance = query({ prompt: input, options: queryOptions });
      return this.mapClaudeEvents(session.id, queryInstance);
    });

    return {
      events: this.wrapGeneratorWithEnv(options.env, generator),
      thread: null as any,
    };
  }

  async generateTitleSuggestion(
    session: SessionRecord,
    conversationJson: string,
  ): Promise<string | null> {
    const workspaceDirectory = ensureWorkspaceDirectory(session.id);

    const prompt = [
      "You generate short, descriptive titles for conversations.",
      "Respond with a concise title (3-5 words), no quotation marks, no extra commentary.",
      "Conversation JSON:",
      conversationJson,
    ].join("\n\n");

    try {
      const options = this.createQueryOptions(workspaceDirectory, session.codexThreadId ?? null);
      const queryInstance = query({ prompt, options });

      let finalText = '';
      for await (const message of queryInstance) {
        if (message.type === 'assistant') {
          const text = this.extractAssistantText(message);
          if (text.length > 0) {
            finalText = text;
          }
        }
      }

      if (!finalText) {
        return null;
      }

      const firstLine = finalText.split(/\r?\n/)[0]?.trim() ?? '';
      if (!firstLine) {
        return null;
      }

      const cleaned = firstLine.replace(/^['"\s]+|['"\s]+$/g, '');
      return cleaned.length > 0 ? cleaned : null;
    } catch (error) {
      console.warn(
        `[codex-webapp] Failed to generate title suggestion for session ${session.id}:`,
        error instanceof Error ? error.message : error,
      );
      return null;
    }
  }

  forgetSession(sessionId: string) {
    this.sessions.delete(sessionId);
  }

  clearThreadCache() {
    this.sessions.clear();
  }
}

export const claudeManager: IAgent = new ClaudeManager();
