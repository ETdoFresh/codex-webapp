import type { Codex, RunResult, Thread } from '@openai/codex-sdk';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { SessionRecord } from './db';

type ThreadCacheEntry = {
  thread: Thread;
};

const dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(dirname, '..');

const require = createRequire(import.meta.url);

let CodexClass: typeof Codex | null = null;

const codexOptions = {
  ...(process.env.CODEX_API_KEY ? { apiKey: process.env.CODEX_API_KEY } : {}),
  ...(process.env.CODEX_BASE_URL ? { baseUrl: process.env.CODEX_BASE_URL } : {}),
  ...(process.env.CODEX_PATH ? { codexPathOverride: process.env.CODEX_PATH } : {})
} as const;

const defaultWorkingDirectory = process.env.CODEX_WORKDIR ?? projectRoot;
const sandboxMode =
  (process.env.CODEX_SANDBOX_MODE as
    | 'read-only'
    | 'workspace-write'
    | 'danger-full-access'
    | undefined) ?? 'workspace-write';

class CodexManager {
  private readonly codex: Codex;
  private readonly threads: Map<string, ThreadCacheEntry>;

  constructor() {
    this.codex = new (getCodexClass())(codexOptions);
    this.threads = new Map();
  }

  private setThread(sessionId: string, thread: Thread) {
    this.threads.set(sessionId, { thread });
  }

  private getThreadFromCache(sessionId: string): Thread | null {
    return this.threads.get(sessionId)?.thread ?? null;
  }

  private createThreadOptions() {
    return {
      sandboxMode,
      workingDirectory: defaultWorkingDirectory,
      skipGitRepoCheck: true,
      ...(process.env.CODEX_MODEL ? { model: process.env.CODEX_MODEL } : {})
    };
  }

  private ensureThread(session: SessionRecord): Thread {
    const cached = this.getThreadFromCache(session.id);
    if (cached) {
      return cached;
    }

    let thread: Thread;
    if (session.codexThreadId) {
      thread = this.codex.resumeThread(session.codexThreadId, this.createThreadOptions());
    } else {
      thread = this.codex.startThread(this.createThreadOptions());
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

function getCodexClass(): typeof Codex {
  if (CodexClass) {
    return CodexClass;
  }

  try {
    const mod = require('@openai/codex-sdk') as { Codex: typeof Codex };
    CodexClass = mod.Codex;
    return CodexClass;
  } catch (error) {
    const message =
      'The @openai/codex-sdk package is required to run Codex conversations. ' +
      'Install it by building the TypeScript SDK from https://github.com/openai/codex (sdk/typescript) ' +
      'and adding it to node_modules, or install a published release when available.';
    throw new Error(`${message}\nOriginal error: ${(error as Error).message}`);
  }
}
