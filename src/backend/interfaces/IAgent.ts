import type { RunTurnResult, RunTurnStreamedResult } from '../types/codex';
import type { SessionRecord } from '../types/database';

export type AgentRunOptions = {
  env?: Record<string, string>;
};

interface IAgent {
  runTurn(session: SessionRecord, input: string, options?: AgentRunOptions): Promise<RunTurnResult>;
  runTurnStreamed(
    session: SessionRecord,
    input: string,
    options?: AgentRunOptions,
  ): Promise<RunTurnStreamedResult>;
  forgetSession(sessionId: string): void;
  clearThreadCache(): void;
  generateTitleSuggestion(
    session: SessionRecord,
    conversationJson: string,
  ): Promise<string | null>;
}

export default IAgent;
