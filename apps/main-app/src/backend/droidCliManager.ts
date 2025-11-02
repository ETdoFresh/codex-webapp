import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import * as readline from 'node:readline';
import type { ThreadItem, Usage } from '@openai/codex-sdk';
import type { RunTurnResult, RunTurnStreamedResult, CodexThreadEvent } from './types/codex';
import type { SessionRecord } from './types/database';
import { ensureWorkspaceDirectory } from './workspaces';
import { getCodexMeta } from './settings';
import type IAgent from './interfaces/IAgent';
import type { AgentRunOptions } from './interfaces/IAgent';

type SessionCacheEntry = {
  sessionId: string | null;
};

type ExecutionSummary = {
  finalText: string;
  items: ThreadItem[];
  usage: Usage;
  sessionId: string | null;
  error: Error | null;
};

type ExecutionController = {
  events: AsyncGenerator<CodexThreadEvent>;
  collectSummary: () => Promise<ExecutionSummary>;
};

const END_SYMBOL = Symbol('droid-cli-stream-end');

const cloneItem = (item: ThreadItem): ThreadItem => ({ ...item });

const normalizeUsage = (value: unknown): Usage => {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const record = value as Record<string, unknown>;

  const toNumber = (candidate: unknown): number | null => {
    if (typeof candidate === 'number' && Number.isFinite(candidate)) {
      return candidate;
    }
    if (typeof candidate === 'string') {
      const parsed = Number(candidate);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
    return null;
  };

  const inputTokens = toNumber(record.input_tokens);
  const cachedTokens = toNumber(record.cached_input_tokens);
  const outputTokens = toNumber(record.output_tokens);

  if (inputTokens === null && cachedTokens === null && outputTokens === null) {
    return null;
  }

  return {
    input_tokens: inputTokens ?? 0,
    cached_input_tokens: cachedTokens ?? 0,
    output_tokens: outputTokens ?? 0
  };
};

const extractSessionId = (record: Record<string, unknown>): string | null => {
  const direct = record.session_id ?? record.sessionId ?? record.thread_id ?? record.threadId;
  if (typeof direct === 'string' && direct.trim().length > 0) {
    return direct.trim();
  }

  if (typeof record.session === 'object' && record.session) {
    const sessionObj = record.session as Record<string, unknown>;
    const nested = sessionObj.id ?? sessionObj.session_id ?? sessionObj.sessionId;
    if (typeof nested === 'string' && nested.trim().length > 0) {
      return nested.trim();
    }
  }

  if (typeof record.id === 'string' && record.id.trim().length > 0) {
    if (typeof record.type === 'string' && record.type.toLowerCase().includes('session')) {
      return record.id.trim();
    }
  }

  return null;
};

class DroidCliManager implements IAgent {
  private readonly sessions: Map<string, SessionCacheEntry>;

  constructor() {
    this.sessions = new Map();
  }

  private getBinaryPath(): string {
    const override = process.env.DROID_PATH?.trim();

    let binaryPath;
    if (override && override.length > 0) {
      binaryPath = override;
      // On Windows with explicit path, ensure proper extension
      if (process.platform === 'win32' && !binaryPath.endsWith('.cmd') && !binaryPath.endsWith('.exe') && !binaryPath.endsWith('.ps1')) {
        binaryPath = binaryPath + '.cmd';
      }
    } else {
      // Default to plain command name and let PATH resolution work
      binaryPath = 'droid';
    }

    return binaryPath;
  }

  private getSessionFromCache(sessionKey: string): SessionCacheEntry | null {
    return this.sessions.get(sessionKey) ?? null;
  }

  private setSessionCache(sessionKey: string, sessionId: string | null) {
    this.sessions.set(sessionKey, { sessionId });
  }

  private createArgs(options: {
    workspaceDirectory: string;
    model: string;
    reasoningEffort: string;
    resumeSessionId: string | null;
    prompt: string;
    reuseSession: boolean;
  }): string[] {
    const args: string[] = ['exec', '--output-format', 'debug'];

    if (options.reuseSession && options.resumeSessionId) {
      args.push('--session-id', options.resumeSessionId);
    }

    if (options.model) {
      args.push('--model', options.model);
    }

    if (options.reasoningEffort) {
      args.push('--reasoning-effort', options.reasoningEffort);
    }

    // Grant the agent permission to mutate files within the workspace.
    args.push('--skip-permissions-unsafe');
    args.push('--cwd', options.workspaceDirectory);

    args.push(options.prompt);
    return args;
  }

  private startExecution(
    session: SessionRecord,
    prompt: string,
    reuseSession: boolean,
    envOverrides?: Record<string, string>
  ): ExecutionController {
    const workspaceDirectory = ensureWorkspaceDirectory(session.id);
    const meta = getCodexMeta();
    const cacheEntry = this.getSessionFromCache(session.id);
    const resumeSessionId = reuseSession
      ? session.codexThreadId ?? cacheEntry?.sessionId ?? null
      : null;

    if (reuseSession && resumeSessionId) {
      this.setSessionCache(session.id, resumeSessionId);
    }

    const args = this.createArgs({
      workspaceDirectory,
      model: meta.model,
      reasoningEffort: meta.reasoningEffort,
      resumeSessionId,
      prompt,
      reuseSession
    });

    const child = spawn(this.getBinaryPath(), args, {
      cwd: workspaceDirectory,
      env: { ...process.env, ...(envOverrides ?? {}) },
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: process.platform === 'win32' // Use shell on Windows for proper .cmd execution
    });

    const queue: Array<CodexThreadEvent | typeof END_SYMBOL> = [];
    const completedItems: ThreadItem[] = [];

    let resolvePending: (() => void) | null = null;
    let ended = false;
    let assistantText = '';
    let agentItem: ThreadItem | null = null;
    let agentItemStarted = false;
    let agentItemCompleted = false;
    let latestUsage: Usage = null;
    let failure: Error | null = null;
    let aggregatedErrorMessage = '';
    let currentSessionId = resumeSessionId;

    let resolveSummary: ((summary: ExecutionSummary) => void) | null = null;
    const summaryPromise = new Promise<ExecutionSummary>((resolve) => {
      resolveSummary = resolve;
    });

    const notify = () => {
      if (resolvePending) {
        const callback = resolvePending;
        resolvePending = null;
        callback();
      }
    };

    const pushEvent = (event: CodexThreadEvent) => {
      if (ended) {
        return;
      }

      if (event.type === 'item.completed') {
        completedItems.push(event.item);
      } else if (event.type === 'turn.completed') {
        latestUsage = event.usage;
      } else if (event.type === 'turn.failed') {
        failure = new Error(event.error?.message ?? 'Droid CLI turn failed');
      } else if (event.type === 'response.completed') {
        const text = Array.isArray(event.output) && event.output.length > 0
          ? typeof event.output[0]?.text === 'string'
            ? event.output[0]?.text ?? ''
            : ''
          : '';
        if (text) {
          assistantText = text;
        }
      }

      queue.push(event);
      notify();
    };

    const endStream = () => {
      if (ended) {
        return;
      }
      ended = true;
      queue.push(END_SYMBOL);
      notify();

      resolveSummary?.({
        finalText: assistantText,
        items: completedItems.length > 0 ? completedItems : agentItem && agentItemCompleted ? [agentItem] : [],
        usage: latestUsage,
        sessionId: currentSessionId,
        error: failure
      });
    };

    const ensureAgentItem = () => {
      if (!agentItem) {
        agentItem = {
          id: randomUUID(),
          type: 'agent_message',
          text: ''
        };
      }
      return agentItem;
    };

    const emitAgentUpdate = (text: string) => {
      const trimmed = text.trimEnd();
      if (trimmed === assistantText) {
        return;
      }

      const delta = trimmed.slice(assistantText.length);
      assistantText = trimmed;

      const item = ensureAgentItem();
      item.text = assistantText;

      if (!agentItemStarted) {
        agentItemStarted = true;
        pushEvent({ type: 'item.started', item: cloneItem(item) });
      } else {
        pushEvent({ type: 'item.updated', item: cloneItem(item) });
      }

      if (delta.length > 0) {
        pushEvent({ type: 'response.output_text.delta', delta });
      }
    };

    const finalizeAgentItem = () => {
      if (!agentItem) {
        return;
      }
      if (!assistantText) {
        return;
      }
      if (!agentItemCompleted) {
        agentItemCompleted = true;
        pushEvent({ type: 'item.completed', item: cloneItem(agentItem) });
      }
      pushEvent({ type: 'response.completed', output: [{ text: assistantText }] });
    };

    const applySessionId = (candidate: string | null) => {
      if (!candidate || candidate.length === 0) {
        return;
      }
      if (currentSessionId === candidate) {
        return;
      }
      currentSessionId = candidate;
      if (reuseSession) {
        this.setSessionCache(session.id, candidate);
      }
      pushEvent({ type: 'thread.started', thread_id: candidate });
    };

    child.stderr?.on('data', (chunk: Buffer | string) => {
      const value = chunk.toString();
      aggregatedErrorMessage += value;
    });

    const lineReader = readline.createInterface({ input: child.stdout });

    lineReader.on('line', (line) => {
      const trimmed = line.trim();
      if (!trimmed) {
        return;
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(trimmed);
      } catch {
        aggregatedErrorMessage += `${trimmed}\n`;
        return;
      }

      if (!parsed || typeof parsed !== 'object') {
        return;
      }

      const record = parsed as Record<string, unknown>;

      const sessionIdCandidate = extractSessionId(record);
      if (sessionIdCandidate) {
        applySessionId(sessionIdCandidate);
      }

      const typeValue = typeof record.type === 'string' ? record.type.toLowerCase() : '';

      if (typeValue === 'message') {
        const role = typeof record.role === 'string' ? record.role.toLowerCase() : '';
        if (role === 'assistant' && typeof record.text === 'string') {
          emitAgentUpdate(record.text);
        }
      } else if (typeValue === 'response' && typeof record.text === 'string') {
        emitAgentUpdate(record.text);
      } else if (typeValue === 'result') {
        if (typeof record.text === 'string') {
          emitAgentUpdate(record.text);
        }
        const usage = normalizeUsage(record.usage);
        if (usage) {
          latestUsage = usage;
        }
      } else if (typeValue === 'usage') {
        const usage = normalizeUsage(record);
        if (usage) {
          latestUsage = usage;
        }
      } else if (typeValue === 'error' || typeValue === 'exception' || typeValue === 'failure') {
        const message = typeof record.message === 'string'
          ? record.message
          : aggregatedErrorMessage || 'Droid CLI reported an error.';
        pushEvent({ type: 'turn.failed', error: { message } });
      }
    });

    const cleanup = () => {
      try {
        lineReader.close();
      } catch {
        // ignore
      }
      if (!child.killed) {
        child.kill('SIGTERM');
      }
    };

    child.on('error', (error) => {
      if (!failure) {
        failure = error instanceof Error ? error : new Error(String(error));
        pushEvent({ type: 'turn.failed', error: { message: failure.message } });
      }
      endStream();
      cleanup();
    });

    child.on('close', (code, signal) => {
      if (code === 0 && !failure) {
        finalizeAgentItem();
        pushEvent({ type: 'turn.completed', usage: latestUsage });
      } else if (!failure) {
        const reason = aggregatedErrorMessage.trim().length > 0
          ? aggregatedErrorMessage.trim()
          : `droid exec exited with code ${code ?? 'null'}${signal ? ` (signal ${signal})` : ''}`;
        pushEvent({ type: 'turn.failed', error: { message: reason } });
        failure = new Error(reason);
      }

      endStream();
      cleanup();
    });

    const iterator: AsyncGenerator<CodexThreadEvent> = {
      async next() {
        if (queue.length === 0 && !ended) {
          await new Promise<void>((resolve) => {
            resolvePending = resolve;
          });
        }

        const entry = queue.shift();
        if (entry === END_SYMBOL || entry === undefined) {
          return { done: true, value: undefined };
        }

        return { done: false, value: entry as CodexThreadEvent };
      },
      async return() {
        cleanup();
        endStream();
        return { done: true, value: undefined };
      },
      async throw(error?: unknown) {
        cleanup();
        endStream();
        throw error;
      },
      [Symbol.asyncIterator]() {
        return this;
      }
    };

    return {
      events: iterator,
      collectSummary: () => summaryPromise
    };
  }

  async runTurn(
    session: SessionRecord,
    input: string,
    options: AgentRunOptions = {}
  ): Promise<RunTurnResult> {
    const controller = this.startExecution(session, input, true, options.env);
    const events = controller.events;

    for await (const _event of events) {
      // Consume stream to drive execution; event aggregation happens inside controller.
    }

    const summary = await controller.collectSummary();

    if (summary.error) {
      throw summary.error;
    }

    if (summary.sessionId && summary.sessionId !== this.getSessionFromCache(session.id)?.sessionId) {
      this.setSessionCache(session.id, summary.sessionId);
    }

    const items = summary.items.length > 0
      ? summary.items
      : summary.finalText
        ? [{ id: randomUUID(), type: 'agent_message', text: summary.finalText }]
        : [];

    return {
      result: {
        items,
        finalResponse: summary.finalText,
        usage: summary.usage
      },
      threadId: summary.sessionId
    };
  }

  async runTurnStreamed(
    session: SessionRecord,
    input: string,
    options: AgentRunOptions = {}
  ): Promise<RunTurnStreamedResult> {
    const controller = this.startExecution(session, input, true, options.env);
    return {
      events: controller.events,
      thread: null as any
    };
  }

  forgetSession(sessionId: string) {
    this.sessions.delete(sessionId);
  }

  clearThreadCache() {
    this.sessions.clear();
  }

  async generateTitleSuggestion(
    session: SessionRecord,
    conversationJson: string
  ): Promise<string | null> {
    const titlePrompt = [
      'You generate short, descriptive titles for conversations.',
      'Respond with a concise title (3-5 words), no quotation marks, no extra commentary.',
      'Conversation JSON:',
      conversationJson
    ].join('\n\n');

    try {
      const controller = this.startExecution(session, titlePrompt, false);
      for await (const _ of controller.events) {
        // Exhaust events for the title run, but ignore content.
      }

      const summary = await controller.collectSummary();
      if (summary.error) {
        throw summary.error;
      }

      const cleaned = summary.finalText.trim();
      return cleaned.length > 0 ? cleaned : null;
    } catch (error) {
      console.warn(
        `[codex-webapp] Droid CLI unavailable for title suggestion in session ${session.id}:`,
        error instanceof Error ? error.message : error
      );
      return null;
    }
  }
}

export const droidCliManager: IAgent = new DroidCliManager();
