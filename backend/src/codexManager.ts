import type { Codex, RunResult, Thread, ThreadItem, Usage } from '@openai/codex-sdk';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { SessionRecord } from './db';
import { ensureWorkspaceDirectory } from './workspaces';
import { getCodexMeta } from './settings';

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

const sandboxMode =
  (process.env.CODEX_SANDBOX_MODE as
    | 'read-only'
    | 'workspace-write'
    | 'danger-full-access'
    | undefined) ?? 'workspace-write';

export type CodexThreadEvent =
  | { type: 'thread.started'; thread_id: string }
  | { type: 'turn.started' }
  | { type: 'turn.completed'; usage: Usage }
  | { type: 'turn.failed'; error: { message: string } | null }
  | { type: 'error'; message: string }
  | { type: 'item.started'; item: ThreadItem }
  | { type: 'item.updated'; item: ThreadItem }
  | { type: 'item.completed'; item: ThreadItem };

class CodexManager {
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
    input: string
  ): Promise<{ result: RunResult; threadId: string | null }> {
    const thread = await this.ensureThread(session);
    const result = await thread.run(input);
    return { result, threadId: thread.id };
  }

  async runTurnStreamed(
    session: SessionRecord,
    input: string
  ): Promise<{ events: AsyncGenerator<CodexThreadEvent>; thread: Thread }> {
    const thread = await this.ensureThread(session);
    const streamed = await (thread as unknown as {
      runStreamed: (input: string) => Promise<{ events: AsyncGenerator<CodexThreadEvent> }>;
    }).runStreamed(input);
    return { events: streamed.events, thread };
  }

  forgetSession(sessionId: string) {
    this.threads.delete(sessionId);
  }

  clearThreadCache() {
    this.threads.clear();
  }
}

export const codexManager = new CodexManager();

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
