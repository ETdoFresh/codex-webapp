# Codex WebApp Agent Playbook

This repository now runs as a single TypeScript workspace that serves the API and React SPA from one Node.js process.

- **src/index.ts** — unified entry point that wires Express, backend routes, and the Vite-powered frontend.
- **src/backend/** — API routes, SQLite persistence, Codex SDK integration, and workspace management.
- **src/frontend/** — Vite + React client (middleware in dev, static bundle in production).

Keep this checklist handy when working in the repo—especially if you are an AI coding assistant or automating workflows.

## Running the stack

1. **Install dependencies** (first run or when `package.json` changes):
   ```bash
   npm install
   ```
2. **Start the dev server**:
   ```bash
   npm run dev
   ```
   - Uses `tsx watch` so backend changes hot-reload automatically.
   - Spins up an in-process Vite dev server (middleware mode) for React fast refresh.
   - Serves everything from a single HTTP port (defaults to `3000`; will increment if occupied).
3. Stop the stack with `Ctrl+C`. The process intercepts shutdown signals to close the HTTP server and Vite cleanly.

Want a production-style run?

```bash
npm run build      # produces dist/server and dist/client
npm start          # serves the compiled server + static SPA
```

## Tooling expectations

- Node.js ≥ 18.17.0
- TypeScript configurations are rooted at the repo level:
  - `tsconfig.server.json` compiles server code to `dist/server`.
  - `tsconfig.client.json` type-checks the Vite client under `src/frontend`.
- `vite.config.ts` already points at `src/frontend` and emits client assets to `dist/client`.
- `npm run typecheck` validates both server and client configs with no emit.

## Codex SDK & CLI

- `@openai/codex-sdk` ships with the unified workspace; the backend expects the CLI or an API key.
- On startup, `src/index.ts` attempts to locate the `codex` binary (`which/where codex`) and sets `CODEX_PATH` automatically if available.
- Provide authentication via `codex login`, `CODEX_API_KEY`, or `OPENAI_API_KEY`. Failed configuration surfaces as HTTP 502 responses with descriptive payloads in the UI.

## Persistent storage & workspaces

- SQLite lives under `var/chat.db` (ignored by Git). If the directory is missing, the server creates it automatically.
- Session workspaces are created in `workspaces/<session-id>`; they are provisioned on demand and cleaned up when sessions are deleted.

## Troubleshooting notes

- If the dev server refuses to bind, check for orphaned Node processes holding port `3000` (or whichever fallback you see in the logs).
- `/health` remains the quickest readiness probe; it reports the database path relative to the repo root and the detected Codex status.
- The frontend still calls `fetch('/api/…')`; confirm API failures with the server logs before assuming client issues.
- When you update dependencies that include native modules (e.g., `better-sqlite3`), restart the dev server so bindings reload.

## Coding conventions

- Service code is TypeScript-first with strict compiler flags. Run `npm run build` (or at least `npm run typecheck`) before handing changes off.
- Keep environment-specific data (logs, database files, workspaces) out of Git; the existing `.gitignore` covers them by default.
- Prefer `apply_patch` or project formatters when modifying files to keep diffs tight.

Keep this document refreshed whenever workflows evolve—future maintainers and coding agents rely on it as the single source of truth.
