import type { Codex, RunResult, Thread } from '@openai/codex-sdk';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { SessionRecord } from './db';
import { ensureWorkspaceDirectory } from './workspaces';

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

class CodexManager {
  private codexInstance: Codex | null = null;
  private readonly threads: Map<string, ThreadCacheEntry>;

  constructor() {
    this.threads = new Map();
  }

  private getCodex(): Codex {
    if (this.codexInstance) {
      return this.codexInstance;
    }

    const CodexCtor = loadCodexClass();
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
    return {
      sandboxMode,
      workingDirectory: workspaceDirectory,
      skipGitRepoCheck: true,
      ...(process.env.CODEX_MODEL ? { model: process.env.CODEX_MODEL } : {})
    };
  }

  private ensureThread(session: SessionRecord): Thread {
    const cached = this.getThreadFromCache(session.id);
    if (cached) {
      return cached;
    }

    const workspaceDirectory = ensureWorkspaceDirectory(session.id);

    let thread: Thread;
    if (session.codexThreadId) {
      thread = this.getCodex().resumeThread(
        session.codexThreadId,
        this.createThreadOptions(workspaceDirectory)
      );
    } else {
      thread = this.getCodex().startThread(this.createThreadOptions(workspaceDirectory));
    }

    this.setThread(session.id, thread);
    return thread;
  }

  async runTurn(
    session: SessionRecord,
    input: string
  ): Promise<{ result: RunResult; threadId: string | null }> {
    const thread = this.ensureThread(session);
    const result = await thread.run(input);
    return { result, threadId: thread.id };
  }

  forgetSession(sessionId: string) {
    this.threads.delete(sessionId);
  }
}

export const codexManager = new CodexManager();

function loadCodexClass(): typeof Codex | null {
  if (CodexClass !== undefined) {
    return CodexClass;
  }

  try {
    const mod = require('@openai/codex-sdk') as { Codex: typeof Codex };
    CodexClass = mod.Codex;
    codexLoadError = null;
  } catch (error) {
    codexLoadError = error instanceof Error ? error : new Error(String(error));
    CodexClass = null;
  }

  return CodexClass;
}
