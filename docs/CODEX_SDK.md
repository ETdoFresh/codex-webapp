# Codex TypeScript SDK Reference

This document describes the public API exported by `@openai/codex-sdk`. The SDK embeds the bundled `codex` CLI to let your Node.js or browser tooling drive the Codex agent programmatically. All examples assume Node.js 18 or later.

## Installation

```bash
npm install @openai/codex-sdk
```

## Quick Start

```typescript
import { Codex } from "@openai/codex-sdk";

const codex = new Codex();
const thread = codex.startThread();
const turn = await thread.run("Diagnose the test failure and propose a fix");

console.log(turn.finalResponse);
console.log(turn.items);
```

Call `run()` repeatedly on the same `Thread` to continue a conversation. To process responses incrementally, use `runStreamed()` (see [Streaming](#streaming)).

---

## API Overview

The package exports the following symbols from `sdk/typescript/src/index.ts`:

- `Codex`
- `Thread`
- Types: `CodexOptions`, `ThreadOptions`, `TurnOptions`, `RunResult`, `RunStreamedResult`, `Input`
- Event types: `ThreadEvent`, `ThreadStartedEvent`, `TurnStartedEvent`, `TurnCompletedEvent`, `TurnFailedEvent`, `ItemStartedEvent`, `ItemUpdatedEvent`, `ItemCompletedEvent`, `ThreadError`, `ThreadErrorEvent`, `Usage`
- Item types: `ThreadItem`, `AgentMessageItem`, `ReasoningItem`, `CommandExecutionItem`, `FileChangeItem`, `McpToolCallItem`, `WebSearchItem`, `TodoListItem`, `ErrorItem`
- Utility string unions: `SandboxMode`, `ApprovalMode`

Each section below details the available classes, methods, and type definitions.

---

## `Codex`

```typescript
class Codex {
  constructor(options?: CodexOptions);
  startThread(options?: ThreadOptions): Thread;
  resumeThread(id: string, options?: ThreadOptions): Thread;
}
```

### Constructor

Creates a client bound to a Codex CLI executable.

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `codexPathOverride` | `string` | auto-detected per platform | Absolute path to a `codex` binary. Override when shipping a custom build or running from source. |
| `baseUrl` | `string` | unset | Custom API base URL. When provided, the spawned process receives `OPENAI_BASE_URL`. |
| `apiKey` | `string` | unset | API key used by the Codex CLI. Written to the child process as `CODEX_API_KEY`. |

### `startThread(options?: ThreadOptions): Thread`

Launches a fresh conversation. The returned `Thread` buffers state internally so subsequent `run` or `runStreamed` calls continue the same session. Thread identifiers become available after the first turn event.

### `resumeThread(id: string, options?: ThreadOptions): Thread`

Reconstructs a `Thread` that was previously started (for example, from `~/.codex/sessions`). Pass the thread ID you persisted and optionally override per-thread options such as model, sandbox mode, or working directory.

Use `resumeThread` when your application restarts or runs multiple processes that share the same long-lived Codex session.

---

## `Thread`

```typescript
class Thread {
  readonly id: string | null;
  run(input: Input, turnOptions?: TurnOptions): Promise<RunResult>;
  runStreamed(input: Input, turnOptions?: TurnOptions): Promise<RunStreamedResult>;
}
```

Threads encapsulate consecutive turns with the same agent.

### `id`

Becomes a non-null string once Codex emits the initial `thread.started` event. Use it to persist the session or resume it later.

### `run(input, turnOptions?)`

Executes a single turn and resolves once the agent finishes. Returns a `RunResult` (alias of `Turn`) containing:

- `items`: ordered array of `ThreadItem` emitted during the turn
- `finalResponse`: text payload of the last completed `agent_message`
- `usage`: token accounting (`Usage`) or `null` if unavailable

If the Codex CLI reports a turn failure (`turn.failed`), `run` throws with the error message provided by the stream.

### `runStreamed(input, turnOptions?)`

Starts a turn and returns immediately with a `RunStreamedResult` containing an `AsyncGenerator<ThreadEvent>`. Iterate the generator to receive structured events (`thread.started`, `turn.started`, item updates, etc.) as they arrive. The generator closes automatically when the turn finishes or fails.

`runStreamed` updates `thread.id` exactly like `run` once it observes a `thread.started` event.

---

## Options and Supporting Types

### `CodexOptions`

```typescript
type CodexOptions = {
  codexPathOverride?: string;
  baseUrl?: string;
  apiKey?: string;
};
```

Configure how the SDK locates and authenticates the `codex` executable.

### `ThreadOptions`

```typescript
type ThreadOptions = {
  model?: string;
  sandboxMode?: SandboxMode;
  workingDirectory?: string;
  skipGitRepoCheck?: boolean;
};
```

- `model`: Explicit model identifier to pass to the CLI (`--model`).
- `sandboxMode`: String union of `"read-only" | "workspace-write" | "danger-full-access"`. Mirrors CLI sandbox modes.
- `workingDirectory`: Directory passed via `--cd`. Codex requires the directory to be a Git repository unless `skipGitRepoCheck` is `true`.
- `skipGitRepoCheck`: Skip the CLI's Git safety verification. Useful for temporary directories in tests.

### `SandboxMode`

```typescript
type SandboxMode = "read-only" | "workspace-write" | "danger-full-access";
```

Provided for convenience when populating `ThreadOptions.sandboxMode`.

### `ApprovalMode`

```typescript
type ApprovalMode = "never" | "on-request" | "on-failure" | "untrusted";
```

A string union that mirrors the CLI's approval policy modes. Exported for consumers that need to coordinate policy values across processes.

### `TurnOptions`

```typescript
type TurnOptions = {
  outputSchema?: unknown;
};
```

- `outputSchema`: Plain JSON object describing the expected agent output. When provided, the SDK writes the schema to a temporary file and invokes `codex exec --output-schema <path>`. Non-object values throw an error.

### `Input`

Alias for `string`. Represents the prompt or user instruction for a turn.

### `RunResult` / `Turn`

```typescript
type Turn = {
  items: ThreadItem[];
  finalResponse: string;
  usage: Usage | null;
};
```

`RunResult` is an alias for `Turn`. `finalResponse` reflects the text from the most recent completed agent message item. `usage` may be `null` if the CLI omits token data.

### `RunStreamedResult` / `StreamedTurn`

```typescript
type RunStreamedResult = {
  events: AsyncGenerator<ThreadEvent>;
};
```

Allows consumers to iterate over events emitted during a turn.

### `Usage`

```typescript
type Usage = {
  input_tokens: number;
  cached_input_tokens: number;
  output_tokens: number;
};
```

Token accounting surfaced when a turn completes.

---

## Thread Events

All events share the discriminant `type` field and are emitted as newline-delimited JSON strings.

| Event | Shape |
| --- | --- |
| `ThreadStartedEvent` | `{ type: "thread.started"; thread_id: string; }` |
| `TurnStartedEvent` | `{ type: "turn.started"; }` |
| `TurnCompletedEvent` | `{ type: "turn.completed"; usage: Usage; }` |
| `TurnFailedEvent` | `{ type: "turn.failed"; error: ThreadError; }` |
| `ItemStartedEvent` | `{ type: "item.started"; item: ThreadItem; }` |
| `ItemUpdatedEvent` | `{ type: "item.updated"; item: ThreadItem; }` |
| `ItemCompletedEvent` | `{ type: "item.completed"; item: ThreadItem; }` |
| `ThreadErrorEvent` | `{ type: "error"; message: string; }` |

`ThreadError` is `{ message: string }`.

---

## Thread Items

`ThreadItem` is a tagged union of the following payloads:

- **`AgentMessageItem`** – `{ id: string; type: "agent_message"; text: string; }`
- **`ReasoningItem`** – `{ id: string; type: "reasoning"; text: string; }`
- **`CommandExecutionItem`** – `{ id: string; type: "command_execution"; command: string; aggregated_output: string; exit_code?: number; status: "in_progress" | "completed" | "failed"; }`
- **`FileChangeItem`** – `{ id: string; type: "file_change"; changes: { path: string; kind: "add" | "delete" | "update"; }[]; status: "completed" | "failed"; }`
- **`McpToolCallItem`** – `{ id: string; type: "mcp_tool_call"; server: string; tool: string; status: "in_progress" | "completed" | "failed"; }`
- **`WebSearchItem`** – `{ id: string; type: "web_search"; query: string; }`
- **`TodoListItem`** – `{ id: string; type: "todo_list"; items: { text: string; completed: boolean; }[]; }`
- **`ErrorItem`** – `{ id: string; type: "error"; message: string; }`

Each item becomes available through both `run()` (in the returned `items` array) and `runStreamed()` (via `item.*` events).

---

## Streaming

Use `runStreamed()` to observe agent activity in real time:

```typescript
const { events } = await thread.runStreamed("Investigate the failing tests");

for await (const event of events) {
  switch (event.type) {
    case "item.completed":
      console.log("Item", event.item);
      break;
    case "turn.completed":
      console.log("Usage", event.usage);
      break;
    case "turn.failed":
      throw new Error(event.error.message);
  }
}
```

Streaming is ideal when you need to surface intermediate progress, monitor tool invocations, or forward events to a UI.

---

## Structured Output

Provide a JSON schema per turn to request structured responses. The schema must be a plain JSON object—objects created with libraries like Zod can be converted before passing them to the SDK.

```typescript
const schema = {
  type: "object",
  properties: {
    summary: { type: "string" },
    status: { type: "string", enum: ["ok", "action_required"] },
  },
  required: ["summary", "status"],
  additionalProperties: false,
} as const;

const turn = await thread.run("Summarize repository status", { outputSchema: schema });
console.log(turn.finalResponse);
```

With Zod:

```typescript
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

const schema = z.object({
  summary: z.string(),
  status: z.enum(["ok", "action_required"]),
});

const turn = await thread.run("Summarize repository status", {
  outputSchema: zodToJsonSchema(schema, { target: "openAi" }),
});
```

The SDK writes the schema to a temporary file and ensures it is removed after the turn finishes, even on failure.

---

## Thread Persistence

Threads are stored under `~/.codex/sessions`. To resume a conversation after process restart:

```typescript
const savedThreadId = process.env.CODEX_THREAD_ID!;
const thread = codex.resumeThread(savedThreadId);
await thread.run("Pick up where we left off");
```

`resumeThread` can also accept new `ThreadOptions`, enabling you to change the working directory or model for future turns.

---

## Working Directory and Sandbox Controls

By default, Codex runs in the current working directory and requires it to be a Git repository. Override these behaviors per thread:

```typescript
const thread = codex.startThread({
  workingDirectory: "/path/to/project",
  skipGitRepoCheck: true,
  sandboxMode: "workspace-write",
});
```

Use sandbox modes to align with the CLI’s seatbelt configuration and protect sensitive environments.

---

## Custom CLI Configuration

- **Binary path**: Use `codexPathOverride` to point to a locally built binary (for example, from `codex-rs`).
- **API endpoint**: Set `baseUrl` when targeting self-hosted endpoints. The SDK forwards it as `OPENAI_BASE_URL` to the child process.
- **Authentication**: Provide `apiKey` to populate `CODEX_API_KEY` for the spawned CLI.

Because the SDK proxies all work through the CLI, it inherits the CLI’s behaviors, logging, and environment expectations.

---

## Samples

See `sdk/typescript/samples` for end-to-end examples:

- `basic_streaming.ts`: Drives `runStreamed` and logs events.
- `structured_output.ts`: Requests JSON output using a literal schema.
- `structured_output_zod.ts`: Demonstrates Zod schema conversion.

These scripts can serve as starting points for your own integrations.

---

## Error Handling

- `Thread.run` and `runStreamed` propagate CLI failures by throwing an `Error` with the message from the underlying stream (for example, rate limits or trust policy violations).
- Invalid `outputSchema` values cause synchronous errors before the CLI spawns.
- If the SDK cannot find a compatible bundled binary, it throws an `Unsupported platform` error. Provide `codexPathOverride` in that case.

---

## Version Compatibility

The SDK ships alongside the Codex CLI in this repository. Ensure the CLI and SDK versions match; otherwise, wire formats may diverge. Pin the npm version and bundled binary together when packaging your application.

