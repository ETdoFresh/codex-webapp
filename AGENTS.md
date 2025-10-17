# Codex WebApp Agent Playbook

This repository hosts a three-service Codex workspace:

- **frontend/** — Vite + React SPA.
- **backend/** — Express + TypeScript API with persistent SQLite storage and Codex integration.
- **proxy/** — Node.js proxy that fronts the other two services on `http://localhost:3000`.

Keep this checklist handy when working in the repo—especially if you are an AI coding assistant or are automating workflows.

## Running the stack

1. **Open a dedicated terminal** for the runtime.
2. From the repository root, run:
   ```bash
   npm run install   # first time only, installs frontend/backend/proxy deps
   npm run dev       # launches all three services with hot reload
   ```
3. The orchestrator (`scripts/run-services.mjs`) starts the frontend, waits for its dev server, then starts the backend, waits for `/health`, and finally launches the proxy. It also attempts to auto-detect the `codex` CLI (`which codex`) and exports `CODEX_PATH` for the backend.
4. Stop the stack with `Ctrl+C` in that terminal.

### Hot reload expectations

- **Frontend**: uses Vite (`npm run dev`), so React components refresh instantly.
- **Backend**: uses `tsx watch src/index.ts`; TypeScript changes trigger a quick recompile and restart.
- **Proxy**: also uses `tsx watch`, so route tweaks reload automatically.

Because all services are hot-reloading, you can edit files while `npm run dev` is still running—just watch the logs for restart confirmations.

> **Tip:** If you restart `npm run dev` and Vite (`5173`), the backend (`4000`), or the proxy (`3000`) refuse to bind because the port is in use, look for orphaned `tsx watch` processes. `lsof -i :5173` (or `:4000`, `:3000`) and `ps -ef | grep 'tsx watch src/index.ts'` are reliable ways to find and kill the stragglers before re-running the orchestrator.

## Codex SDK & CLI

- The backend requires `@openai/codex-sdk` (installed in `backend/package.json`).
- The orchestrator injects `CODEX_PATH` automatically if a `codex` binary exists on the host. Otherwise set `CODEX_PATH` manually or install the CLI (`npm install -g @openai/codex` or `brew install codex`).
- Provide authentication through `codex login` or `CODEX_API_KEY`/`OPENAI_API_KEY` environment variables. Without a working SDK/CLI configuration, API calls return HTTP 502 with a descriptive error bubble in the UI.
- If you see a 502 that says `Codex SDK is not installed. ... Original error: No "exports" main defined ...`, replace any locally bundled tarball with the published package: run `npm install @openai/codex-sdk@latest` inside `backend/`, then restart the stack so the backend picks up the new module.

## Testing with Chrome DevTools MCP

We routinely drive end-to-end tests using the Chrome DevTools MCP integration:

1. Ensure `npm run dev` is active.
2. Use DevTools MCP commands to open `http://localhost:3000`, click UI elements, send messages, and inspect console/network output.
3. This workflow is ideal for verifying paths, checking proxy rewrites, and capturing user-visible errors (e.g., Codex misconfiguration, health failures).

## Persistent storage & workspaces

- SQLite files live under `backend/var/chat.db` (ignored by Git). Each session also gets a workspace directory in `backend/workspaces/<session-id>`; these are created on demand and cleaned up when sessions are deleted.

## Common scripts

- `npm run build` — builds frontend, backend, and proxy.
- `npm run start` — production-style start (builds first, then runs).
- `npm run install` — runs `npm install` in each service; use after dependency changes.

## Troubleshooting notes

- If the frontend reports `ApiError 404` for `/api/sessions`, check the proxy’s `pathRewrite` settings. The middleware should leave the `/api` prefix intact when forwarding (`pathRewrite: (path) => (path.startsWith('/api') ? path : \`/api\${path}\`)`).
- 502 responses from the backend usually mean Codex SDK/CLI isn’t configured.
- The proxy’s `/health` endpoint performs a basic downstream check (`/health` for backend and the frontend dev server or static bundle); watch these logs when diagnosing startup issues.

## Coding conventions

- All services are TypeScript-first with strict settings; run `npm run build` before finishing any change.
- Keep environment-specific data (logs, database, workspace directories) out of Git; the existing `.gitignore` covers the defaults.
- Prefer `apply_patch` or project-specific formatters when modifying files to keep diffs tight.

Keep this document up to date whenever the workflow shifts—future maintainers and coding agents rely on it as the single source of truth.***
