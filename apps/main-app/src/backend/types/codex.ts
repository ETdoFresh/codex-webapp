import type { RunResult, ThreadItem, Thread, Usage } from '@openai/codex-sdk';

export type CodexThreadEvent =
  | { type: 'thread.started'; thread_id: string }
  | { type: 'turn.started' }
  | { type: 'turn.completed'; usage: Usage }
  | { type: 'turn.failed'; error: { message: string } | null }
  | { type: 'error'; message: string }
  | { type: 'item.started'; item: ThreadItem }
  | { type: 'item.updated'; item: ThreadItem }
  | { type: 'item.completed'; item: ThreadItem }
  | { type: 'response.output_text.delta'; delta: string }
  | { type: 'response.completed'; output: Array<{ text?: string }> };

export type RunTurnResult = {
  result: RunResult;
  threadId: string | null;
};

export type RunTurnStreamedResult = {
  events: AsyncGenerator<CodexThreadEvent>;
  thread: Thread;
};
