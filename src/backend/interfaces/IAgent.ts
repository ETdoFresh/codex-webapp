import type { RunTurnResult, RunTurnStreamedResult } from '../types/codex';
import type { SessionRecord } from '../types/database';

interface IAgent {
  runTurn(session: SessionRecord, input: string): Promise<RunTurnResult>;
  runTurnStreamed(session: SessionRecord, input: string): Promise<RunTurnStreamedResult>;
  forgetSession(sessionId: string): void;
  clearThreadCache(): void;
  generateTitleSuggestion(
    session: SessionRecord,
    conversationJson: string,
  ): Promise<string | null>;
}

export default IAgent;
