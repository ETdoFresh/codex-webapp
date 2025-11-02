declare module '@openai/codex-sdk' {
  export type SandboxMode = 'read-only' | 'workspace-write' | 'danger-full-access';

  export type CodexOptions = {
    codexPathOverride?: string;
    baseUrl?: string;
    apiKey?: string;
  };

  export type ThreadOptions = {
    model?: string;
    sandboxMode?: SandboxMode;
    workingDirectory?: string;
    skipGitRepoCheck?: boolean;
  };

  export type Usage = {
    input_tokens: number;
    cached_input_tokens: number;
    output_tokens: number;
  } | null;

  export type ThreadItem = {
    type: string;
    [key: string]: unknown;
  };

  export type RunResult = {
    items: ThreadItem[];
    finalResponse: string;
    usage: Usage;
  };

  export class Thread {
    id: string | null;
    run(input: string, turnOptions?: unknown): Promise<RunResult>;
  }

  export class Codex {
    constructor(options?: CodexOptions);
    startThread(options?: ThreadOptions): Thread;
    resumeThread(id: string, options?: ThreadOptions): Thread;
  }
}
