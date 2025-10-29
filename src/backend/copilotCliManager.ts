import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import type { ThreadItem, Usage } from '@openai/codex-sdk';
import type { RunTurnResult, RunTurnStreamedResult, CodexThreadEvent } from './types/codex';
import type { SessionRecord } from './types/database';
import { ensureWorkspaceDirectory } from './workspaces';
import { getCodexMeta } from './settings';
import type IAgent from './interfaces/IAgent';
import type { AgentRunOptions } from './interfaces/IAgent';

/**
 * CopilotCliManager - GitHub Copilot CLI integration
 * 
 * LIMITATIONS:
 * - No true streaming: responses come back as complete text blocks
 * - Auto-approval required: uses --allow-all-tools for headless operation
 * - No session persistence: each turn creates new session unless --resume is used
 * - Text parsing: no structured JSON output guaranteed
 * 
 * SECURITY NOTES:
 * - Requires GitHub Copilot subscription
 * - Requires gh CLI authenticated
 * - --allow-all-tools grants full system access
 */

type ExecutionResult = {
  text: string;
  error: Error | null;
};

class CopilotCliManager implements IAgent {
  constructor() {}

  private getBinaryPath(): string {
    const override = process.env.COPILOT_PATH?.trim();
    if (override && override.length > 0) {
      return override;
    }
    return 'copilot';
  }

  private getDefaultModel(): string {
    const override = process.env.COPILOT_MODEL?.trim();
    if (override && override.length > 0) {
      return override;
    }
    return 'claude-sonnet-4.5';
  }

  /**
   * Execute a Copilot CLI command and collect the output
   * Uses shell mode with properly quoted prompt to handle .cmd wrapper
   */
  private async executeCommand(
    workspaceDir: string,
    prompt: string,
    model: string,
    env?: Record<string, string>
  ): Promise<ExecutionResult> {
    const binaryPath = this.getBinaryPath();
    
    // Escape double quotes in prompt by doubling them for Windows cmd.exe
    const escapedPrompt = prompt.replace(/"/g, '""');
    
    // Build command string with properly quoted prompt
    const commandString = `${binaryPath} -p "${escapedPrompt}" --allow-all-tools --add-dir "${workspaceDir}" --model ${model} --no-color`;

    console.log(`[CopilotCLI] Command: ${commandString}`);

    return new Promise((resolve) => {
      const spawnOptions = {
        cwd: workspaceDir,
        env: { ...process.env, ...env },
        stdio: 'pipe' as const,
        shell: true, // Use shell to handle .cmd wrapper and properly quoted args
        windowsHide: true // Hide console window on Windows
      };
      
      console.log('[CopilotCLI] Spawn options:', JSON.stringify({
        cwd: spawnOptions.cwd,
        stdio: spawnOptions.stdio,
        shell: spawnOptions.shell,
        windowsHide: spawnOptions.windowsHide,
      }, null, 2));
      
      // Pass command as single string when using shell mode
      const proc = spawn(commandString, [], spawnOptions);

      let stdout = '';
      let stderr = '';

      proc.stdout?.on('data', (chunk: Buffer) => {
        const text = chunk.toString();
        console.log('[CopilotCLI] stdout chunk:', text);
        stdout += text;
      });

      proc.stderr?.on('data', (chunk: Buffer) => {
        const text = chunk.toString();
        console.log('[CopilotCLI] stderr chunk:', text);
        stderr += text;
      });

      proc.on('error', (err: Error) => {
        console.error('[CopilotCLI] Process error:', err);
        resolve({
          text: '',
          error: new Error(`Failed to spawn copilot CLI: ${err.message}`)
        });
      });

      proc.on('close', (code: number | null) => {
        console.log(`[CopilotCLI] Process closed with code ${code}`);
        console.log(`[CopilotCLI] stdout length: ${stdout.length}`);
        console.log(`[CopilotCLI] stderr length: ${stderr.length}`);
        console.log(`[CopilotCLI] stdout:`, stdout);
        console.log(`[CopilotCLI] stderr:`, stderr);
        
        if (code !== 0) {
          console.error(`[CopilotCLI] Process exited with code ${code}`);
          resolve({
            text: stdout,
            error: new Error(`Copilot CLI exited with code ${code}: ${stderr}`)
          });
        } else {
          console.log(`[CopilotCLI] Process completed successfully`);
          resolve({
            text: stdout,
            error: null
          });
        }
      });
    });
  }

  /**
   * Clean up the Copilot CLI output by removing ANSI codes and extra formatting
   */
  private cleanOutput(text: string): string {
    // Remove ANSI escape codes
    let cleaned = text.replace(/\x1b\[[0-9;]*m/g, '');
    
    // Remove Copilot CLI usage statistics (everything from "Total usage est:" onwards)
    const usageStatsIndex = cleaned.indexOf('\n\nTotal usage est:');
    if (usageStatsIndex !== -1) {
      cleaned = cleaned.substring(0, usageStatsIndex);
    }
    
    // Also try alternative format
    const altUsageIndex = cleaned.indexOf('\nTotal usage est:');
    if (altUsageIndex !== -1) {
      cleaned = cleaned.substring(0, altUsageIndex);
    }
    
    // Remove common Copilot CLI formatting patterns
    cleaned = cleaned.replace(/^[\s\r\n]+/, ''); // Leading whitespace
    cleaned = cleaned.replace(/[\s\r\n]+$/, ''); // Trailing whitespace
    
    return cleaned;
  }

  /**
   * Convert execution result into ThreadItem format
   */
  private resultToThreadItem(result: ExecutionResult, messageId: string): ThreadItem {
    if (result.error) {
      return {
        id: messageId,
        type: 'agent_message',
        role: 'assistant',
        text: `Error: ${result.error.message}`
      };
    }

    const cleanedText = this.cleanOutput(result.text);
    
    return {
      id: messageId,
      type: 'agent_message',
      role: 'assistant',
      text: cleanedText || 'No response from Copilot CLI'
    };
  }

  /**
   * Generate fake usage stats since Copilot CLI doesn't provide them
   */
  private generateUsageEstimate(text: string): Usage {
    // Rough estimate: ~4 chars per token
    const outputTokens = Math.ceil(text.length / 4);
    
    return {
      input_tokens: 0,
      cached_input_tokens: 0,
      output_tokens: outputTokens
    };
  }

  async runTurn(
    session: SessionRecord,
    input: string,
    options?: AgentRunOptions
  ): Promise<RunTurnResult> {
    const workspaceDir = await ensureWorkspaceDirectory(session.id);
    const meta = getCodexMeta();
    const model = meta.model || this.getDefaultModel();

    console.log(`[CopilotCLI] runTurn for session ${session.id}`);
    console.log(`[CopilotCLI] Model: ${model}`);
    console.log(`[CopilotCLI] Workspace: ${workspaceDir}`);

    const result = await this.executeCommand(
      workspaceDir,
      input,
      model,
      options?.env
    );

    const messageId = randomUUID();
    const threadItem = this.resultToThreadItem(result, messageId);
    const itemText = threadItem.text as string;
    const usage = result.error ? null : this.generateUsageEstimate(itemText);

    // Always return the thread item, even if there's an error
    const items = [threadItem];

    return {
      result: {
        items,
        finalResponse: itemText,
        usage
      },
      threadId: null
    };
  }

  async runTurnStreamed(
    session: SessionRecord,
    input: string,
    options?: AgentRunOptions
  ): Promise<RunTurnStreamedResult> {
    const workspaceDir = await ensureWorkspaceDirectory(session.id);
    const meta = getCodexMeta();
    const model = meta.model || this.getDefaultModel();

    console.log(`[CopilotCLI] runTurnStreamed for session ${session.id}`);

    // Execute the command and collect the full output
    const resultPromise = this.executeCommand(
      workspaceDir,
      input,
      model,
      options?.env
    );

    const messageId = randomUUID();
    let finalItem: ThreadItem | null = null;
    let finalUsage: Usage | null = null;
    let finalError: Error | null = null;

    // Create an async generator that yields events in the expected format
    const events = (async function* (this: CopilotCliManager) {
      const result = await resultPromise;
      
      finalError = result.error;
      finalItem = this.resultToThreadItem(result, messageId);
      const itemText = finalItem.text as string;
      finalUsage = result.error ? null : this.generateUsageEstimate(itemText);

      // Yield item.started event
      yield {
        type: 'item.started' as const,
        item: finalItem
      };

      // Yield item.completed event
      yield {
        type: 'item.completed' as const,
        item: finalItem
      };

      // Yield turn.completed event
      if (!finalError) {
        yield {
          type: 'turn.completed' as const,
          usage: finalUsage
        };
      } else {
        yield {
          type: 'turn.failed' as const,
          error: { message: finalError.message }
        };
      }
    }).call(this);

    // Create a fake thread object
    const thread = {
      id: null,
      run: async () => ({ items: [], finalResponse: '', usage: null }),
    } as any;

    return {
      events,
      thread
    };
  }

  /**
   * Forget a session - no-op for Copilot CLI since it doesn't persist sessions
   */
  forgetSession(sessionId: string): void {
    console.log(`[CopilotCLI] forgetSession called for ${sessionId} (no-op)`);
    // Copilot CLI manages its own sessions, we can't explicitly forget them
  }

  /**
   * Clear thread cache - no-op for Copilot CLI
   */
  clearThreadCache(): void {
    console.log(`[CopilotCLI] clearThreadCache called (no-op)`);
    // No cache to clear
  }

  /**
   * Generate a title suggestion for the conversation
   */
  async generateTitleSuggestion(
    session: SessionRecord,
    conversationJson: string
  ): Promise<string | null> {
    const workspaceDir = await ensureWorkspaceDirectory(session.id);
    const meta = getCodexMeta();
    const model = meta.model || this.getDefaultModel();

    const prompt = `Based on this conversation, generate a short, descriptive title (maximum 6 words):

${conversationJson}

Respond with ONLY the title, no explanation or extra text.`;

    console.log(`[CopilotCLI] Generating title suggestion for session ${session.id}`);

    const result = await this.executeCommand(
      workspaceDir,
      prompt,
      model
    );

    if (result.error) {
      console.error('[CopilotCLI] Title generation failed:', result.error);
      return null;
    }

    const title = this.cleanOutput(result.text);
    
    // Truncate if too long and ensure it's reasonable
    if (title.length === 0) {
      return null;
    }

    if (title.length > 60) {
      return title.substring(0, 57) + '...';
    }

    return title;
  }
}

// Singleton instance
let instance: CopilotCliManager | null = null;

export function getCopilotCliManager(): CopilotCliManager {
  if (!instance) {
    instance = new CopilotCliManager();
  }
  return instance;
}

export function createCopilotCliManager(): CopilotCliManager {
  return new CopilotCliManager();
}

export default CopilotCliManager;
