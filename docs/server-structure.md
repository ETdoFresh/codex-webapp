# Server Structure Overview

This project consists of three coordinated Node.js applications that run behind a lightweight proxy. They share one domain (for example `http://localhost:3000`), so the proxy handles all routing.

```
/
|- frontend/   # Vite + TypeScript SPA with health indicator and counter demo
|- backend/    # TypeScript API server (Express or similar)
|- proxy/       # Routing layer that fronts the other services
|- package.json # Root scripts that orchestrate the three projects
```

## Folders and Responsibilities

- **frontend/**
  - Vite + TypeScript single-page app with a basic counter to confirm reactivity.
  - Polls `GET /api/health` on the same origin (via the proxy) and renders a status chip (green/healthy, red/error, gray/unknown) in the page header.

- **backend/**
  - TypeScript service built with Express (or comparable) exposing API routes.
  - Implements `GET /health` returning diagnostics consumed by the front end and proxy.

- **proxy/**
  - Node.js service listening on port `3000` by default, falling back to `3001`, `3002`, and so on if needed.
  - Serves static assets from the frontend build or dev server.
  - Forwards any request beginning with `/api` to the backend service; all other paths go to the front end.

## Startup Expectations

1. Start the frontend dev server (Vite) to obtain its host and port.
2. Start the backend API server to obtain its host and port.
3. Launch the proxy with both endpoints supplied (environment variables or CLI args). The proxy should retry alternative listen ports if `3000` is busy.

## Root package.json Scripts

The repository root should include a `package.json` that coordinates the three packages with these scripts:

- `install`: runs `npm install` inside `frontend`, `backend`, and `proxy` so dependencies stay isolated.
- `start`: runs `npm run start` in each project (front end, back end, proxy) and follows the startup expectations above.
- `dev`: runs `npm run dev` in each project, ensuring the front end and back end are ready before the proxy begins forwarding traffic.

## Networking Assumptions

- frontend code always calls API routes relative to the current origin (for example `fetch('/api/health')`).
- The proxy maps `/api/*` to the API server and routes all other requests to the front end.
- When the proxy starts, it should verify that both downstream services are reachable before accepting traffic, or log clear errors if they are not.

## Initial Implementation Steps

1. Scaffold each package with its own `package.json` and TypeScript config.
2. Implement the health endpoint in the back end and the status indicator in the frontend UI.
3. Flesh out the proxy to manage port negotiation, request forwarding, and downstream availability checks.
