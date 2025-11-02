import type { Codex, Thread } from '@openai/codex-sdk';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { RunTurnResult, RunTurnStreamedResult, CodexThreadEvent } from './types/codex';
import type { SessionRecord } from './types/database';
import { ensureWorkspaceDirectory } from './workspaces';
import { getCodexMeta } from './settings';
import type IAgent from './interfaces/IAgent';
import type { AgentRunOptions } from './interfaces/IAgent';

type ThreadCacheEntry = {
  thread: Thread;
};

const dirname = path.dirname(fileURLToPath(import.meta.url));

const require = createRequire(import.meta.url);

let CodexClass: typeof Codex | null | undefined;
let codexLoadError: Error | null = null;

const codexOptions = {
  ...(process.env.CODEX_API_KEY ? { apiKey: process.env.CODEX_API_KEY } : {}),
  ...(process.env.CODEX_BASE_URL ? { baseUrl: process.env.CODEX_BASE_URL } : {}),
  ...(process.env.CODEX_PATH ? { codexPathOverride: process.env.CODEX_PATH } : {})
} as const;

const resolvedSandboxEnv = process.env.CODEX_SANDBOX_MODE as
  | 'read-only'
  | 'workspace-write'
  | 'danger-full-access'
  | undefined;

const sandboxMode: 'read-only' | 'workspace-write' | 'danger-full-access' =
  resolvedSandboxEnv ??
  (process.platform === 'win32' ? 'danger-full-access' : 'workspace-write');

const applyEnvOverrides = (env: AgentRunOptions['env']): (() => void) => {
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
};

const withEnvOverrides = async <T>(
  env: AgentRunOptions['env'],
  action: () => Promise<T>,
): Promise<T> => {
  const restore = applyEnvOverrides(env);
  try {
    return await action();
  } finally {
    restore();
  }
};

const wrapGeneratorWithEnv = <T>(
  env: AgentRunOptions['env'],
  generator: AsyncGenerator<T>,
): AsyncGenerator<T> => {
  if (!env || Object.keys(env).length === 0) {
    return generator;
  }

  return (async function* wrapped() {
    const restore = applyEnvOverrides(env);
    try {
      for await (const item of generator) {
        yield item;
      }
    } finally {
      restore();
    }
  })();
};

class CodexManager implements IAgent {
  private codexInstance: Codex | null = null;
  private readonly threads: Map<string, ThreadCacheEntry>;

  constructor() {
    this.threads = new Map();
  }

  private async getCodex(): Promise<Codex> {
    if (this.codexInstance) {
      return this.codexInstance;
    }

    const CodexCtor = await loadCodexClass();
    if (!CodexCtor) {
      const errorMessage =
        'Codex SDK is not installed. Build the SDK from https://github.com/openai/codex and install it into backend/node_modules, or set CODEX_PATH to a codex binary.';
      const underlying = codexLoadError;
      const message = underlying ? `${errorMessage}\nOriginal error: ${underlying.message}` : errorMessage;
      const error = new Error(message);
      error.name = 'CodexMissingError';
      throw error;
    }

    this.codexInstance = new CodexCtor(codexOptions);
    return this.codexInstance;
  }

  private setThread(sessionId: string, thread: Thread) {
    this.threads.set(sessionId, { thread });
  }

  private getThreadFromCache(sessionId: string): Thread | null {
    return this.threads.get(sessionId)?.thread ?? null;
  }

  private createThreadOptions(workspaceDirectory: string) {
    const { model } = getCodexMeta();
    return {
      sandboxMode,
      workingDirectory: workspaceDirectory,
      skipGitRepoCheck: true,
      ...(model ? { model } : {})
    };
  }

  private async ensureThread(session: SessionRecord): Promise<Thread> {
    const cached = this.getThreadFromCache(session.id);
    if (cached) {
      return cached;
    }

    const workspaceDirectory = ensureWorkspaceDirectory(session.id);

    const codex = await this.getCodex();

    let thread: Thread;
    if (session.codexThreadId) {
      thread = codex.resumeThread(session.codexThreadId, this.createThreadOptions(workspaceDirectory));
    } else {
      thread = codex.startThread(this.createThreadOptions(workspaceDirectory));
    }

    this.setThread(session.id, thread);
    return thread;
  }

  async runTurn(
    session: SessionRecord,
    input: string,
    options: AgentRunOptions = {},
  ): Promise<RunTurnResult> {
    return withEnvOverrides(options.env, async () => {
      const thread = await this.ensureThread(session);
      const result = await thread.run(input);
      return { result, threadId: thread.id };
    });
  }

  async runTurnStreamed(
    session: SessionRecord,
    input: string,
    options: AgentRunOptions = {}
  ): Promise<RunTurnStreamedResult> {
    return withEnvOverrides(options.env, async () => {
      const thread = await this.ensureThread(session);
      const streamed = await (thread as unknown as {
        runStreamed: (input: string) => Promise<{ events: AsyncGenerator<CodexThreadEvent> }>;
      }).runStreamed(input);
      const events = wrapGeneratorWithEnv(options.env, streamed.events);
      return { events, thread };
    });
  }

  forgetSession(sessionId: string) {
    this.threads.delete(sessionId);
  }

  clearThreadCache() {
    this.threads.clear();
  }

  async generateTitleSuggestion(
    session: SessionRecord,
    conversationJson: string,
  ): Promise<string | null> {
    let codexInstance: Codex;
    try {
      codexInstance = await this.getCodex();
    } catch (error) {
      console.warn(
        `[codex-webapp] Codex unavailable for title suggestion in session ${session.id}:`,
        error instanceof Error ? error.message : error,
      );
      return null;
    }

    const workspaceDirectory = ensureWorkspaceDirectory(session.id);
    const thread = codexInstance.startThread(
      this.createThreadOptions(workspaceDirectory),
    );

    const prompt = [
      "You generate short, descriptive titles for conversations.",
      "Respond with a concise title (3-5 words), no quotation marks, no extra commentary.",
      "Conversation JSON:",
      conversationJson,
    ].join("\n\n");

    try {
      const result = await thread.run(prompt);
      const final = (result.finalResponse ?? "").trim();
      if (!final) {
        return null;
      }

      const firstLine = final.split(/\r?\n/)[0]?.trim() ?? "";
      if (!firstLine) {
        return null;
      }

      const cleaned = firstLine.replace(/^['"\s]+|['"\s]+$/g, "");
      return cleaned.length > 0 ? cleaned : null;
    } catch (error) {
      console.warn(
        `[codex-webapp] Failed to generate title suggestion for session ${session.id}:`,
        error instanceof Error ? error.message : error,
      );
      return null;
    }
  }
}

export const codexManager: IAgent = new CodexManager();

async function loadCodexClass(): Promise<typeof Codex | null> {
  if (CodexClass !== undefined) {
    return CodexClass;
  }

  try {
    const mod = await import('@openai/codex-sdk') as { Codex: typeof Codex };
    CodexClass = mod.Codex;
    codexLoadError = null;
  } catch (error) {
    codexLoadError = error instanceof Error ? error : new Error(String(error));
    CodexClass = null;
  }

  return CodexClass;
}
