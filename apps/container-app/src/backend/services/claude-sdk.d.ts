declare module '@anthropic-ai/claude-agent-sdk/sdk.mjs' {
  export function query(message: string, options: any): AsyncIterable<any>;
}
