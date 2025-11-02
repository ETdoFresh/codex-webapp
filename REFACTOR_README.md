# Codex WebApp - Containerized Architecture

This is the refactored version of Codex WebApp that splits the application into:
- **Main App**: Session orchestration, authentication, and database management
- **Container App**: Isolated per-session environments running code assistants

## Architecture Overview

```
┌─────────────────────────────────────────────┐
│           Main App (Port 3000)              │
│  - User Authentication                      │
│  - Session Management                       │
│  - SQLite Database (single source of truth) │
│  - Session List UI                          │
│  - Container Orchestration                  │
└─────────────┬───────────────────────────────┘
              │
              │ WebSocket (streaming)
              │ HTTP Webhooks (persistence)
              │ Dokploy Provisioning
              │
    ┌─────────▼─────────┐  ┌──────────────┐
    │ Container App     │  │ Container App│
    │ (Session A)       │  │ (Session B)  │
    │ - Port: Dynamic   │  │ - Port: Dyn. │
    │ - Codex/Claude/   │  │ - Isolated   │
    │   Droid Agents    │  │   Workspace  │
    │ - Workspace: /ws  │  │ - Full Shell │
    └───────────────────┘  └──────────────┘
```

## Key Features

1. **Isolation**: Each session runs in its own Docker container
2. **Dangerous Mode**: Containers can execute arbitrary code safely
3. **Real-time Streaming**: WebSocket connection for live output
4. **Single Source of Truth**: Main app database stores all messages
5. **Iframe Integration**: Container UI embedded in main app

## Setup Instructions

### Prerequisites

- Node.js >= 18.17.0
- Docker (for container deployment)
- Dokploy server (configured separately)

### 1. Install Dependencies

```bash
cd /path/to/codex-webapp
npm install
```

This installs dependencies for all workspace packages (main-app, container-app, shared).

### 2. Environment Variables

Create `.env` files in both apps:

**Main App** (`apps/main-app/.env`):
```bash
# Server
PORT=3000
NODE_ENV=development

# Security
JWT_SECRET=your-secret-key-change-in-production

# Dokploy (for container provisioning)
DOKPLOY_BASE_URL=https://dokploy.example.com
DOKPLOY_API_KEY=your-dokploy-api-key

# Container Connection
MAIN_APP_URL=http://localhost:3000
MAIN_APP_WS_URL=ws://localhost:3000

# Database
DATABASE_PATH=./var/chat.db

# Auth
CODEX_WEBAPP_SECRET=your-encryption-secret
```

**Container App** (`apps/container-app/.env` - set by Dokploy):
```bash
# Set automatically by containerManager.ts
SESSION_ID=<session-id>
SESSION_TOKEN=<jwt-token>
MAIN_APP_URL=http://localhost:3000
MAIN_APP_WS_URL=ws://localhost:3000
WORKSPACE_PATH=/workspace

# Auth files (base64 encoded by Dokploy)
CODEX_AUTH_FILE_1=<base64>
CLAUDE_AUTH_FILE_1=<base64>
```

### 3. Development

**Run Main App:**
```bash
npm run dev:main
# or from root: npm run dev
```

**Run Container App (for testing):**
```bash
npm run dev:container
```

**Access:**
- Main App: http://localhost:3000
- Container App: http://localhost:3001 (standalone for testing)

### 4. Production Build

```bash
# Build all apps
npm run build

# Or individually
npm run build:main
npm run build:container
```

### 5. Docker Container Build

```bash
# Build container app image
cd apps/container-app
docker build -t codex-container-app:latest .

# Test run (manual)
docker run -p 3001:3001 \
  -e SESSION_ID=test-session \
  -e SESSION_TOKEN=test-token \
  -e MAIN_APP_URL=http://host.docker.internal:3000 \
  -e MAIN_APP_WS_URL=ws://host.docker.internal:3000 \
  -v /tmp/workspace:/workspace \
  codex-container-app:latest
```

## Project Structure

```
codex-webapp/
├── apps/
│   ├── main-app/              # Main orchestration app
│   │   ├── src/
│   │   │   ├── backend/
│   │   │   │   ├── routes/
│   │   │   │   │   ├── sessionRoutes.ts
│   │   │   │   │   ├── containerWebhookRoutes.ts  ← NEW
│   │   │   │   │   ├── sessionContainerRoutes.ts
│   │   │   │   ├── services/
│   │   │   │   │   ├── sessionTokenService.ts     ← NEW
│   │   │   │   │   ├── websocketBridge.ts         ← NEW
│   │   │   │   │   ├── containerManager.ts        (updated)
│   │   │   ├── frontend/
│   │   │   │   ├── src/
│   │   │   │   │   ├── components/
│   │   │   │   │   │   ├── ContainerIframe.tsx   ← NEW
│   │   │   │   │   │   ├── SessionList.tsx       ← NEW
│   │   │   │   │   ├── AppSimplified.tsx         ← NEW (simplified UI)
│   │   │
│   ├── container-app/         # Per-session container app
│   │   ├── src/
│   │   │   ├── backend/
│   │   │   │   ├── routes/
│   │   │   │   │   ├── messageRoutes.ts          ← NEW
│   │   │   │   │   ├── workspaceRoutes.ts        ← NEW
│   │   │   │   ├── services/
│   │   │   │   │   ├── mainAppClient.ts          ← NEW
│   │   │   │   │   ├── agentRunner.ts            ← NEW
│   │   │   │   ├── middleware/
│   │   │   │   │   ├── validateToken.ts          ← NEW
│   │   │   ├── frontend/
│   │   │   │   ├── src/
│   │   │   │   │   ├── App.tsx                   ← NEW (single-session UI)
│   │   │   │   │   ├── hooks/
│   │   │   │   │   │   ├── useMainAppBridge.ts  ← NEW
│   │   │   │   │   │   ├── useWebSocket.ts      ← NEW
│   │   ├── Dockerfile                            ← NEW
│   │   ├── scripts/
│   │   │   ├── container-init.sh                 ← NEW
│   │
│   ├── shared/                # Shared types package
│   │   ├── src/
│   │   │   ├── types/
│   │   │   │   ├── bridge.ts                     ← NEW
│   │   │   │   ├── session.ts                    ← NEW
│   │   │   │   ├── message.ts                    ← NEW
│
├── package.json               # Root workspace config
```

## Communication Flow

### 1. Session Creation

```
User clicks "New Session" in Main App
  ↓
Main App creates session in database
  ↓
Main App generates JWT session token
  ↓
Main App calls containerManager.createContainer()
  ↓
containerManager provisions Dokploy application
  ↓
Dokploy deploys container with env vars:
  - SESSION_ID
  - SESSION_TOKEN  
  - MAIN_APP_URL
  - MAIN_APP_WS_URL
  - Auth files (base64 encoded)
  ↓
Container starts, runs init.sh to decode auth files
  ↓
Container backend connects WebSocket to Main App
  ↓
Container sends postMessage "READY" to parent
  ↓
Main App shows container iframe
```

### 2. Message Flow

```
User types message in Container UI
  ↓
Container frontend POST /api/messages
  ↓
Container backend:
  1. POST message to Main App webhook
  2. Run agent (Codex/Claude/Droid)
  3. Stream chunks via WebSocket to Main App
  4. POST final message to Main App
  ↓
Main App:
  1. Stores messages in SQLite
  2. Broadcasts WebSocket chunks to all clients
  ↓
Container frontend receives WebSocket chunks
  ↓
Updates UI in real-time
```

## API Endpoints

### Main App

**Authentication:**
- `POST /api/auth/login` - User login
- `POST /api/auth/logout` - User logout

**Sessions:**
- `GET /api/sessions` - List all sessions
- `POST /api/sessions` - Create new session
- `DELETE /api/sessions/:id` - Delete session
- `GET /api/sessions/:id/messages` - Get messages (deprecated, use container webhooks)

**Container Management:**
- `POST /api/sessions/:id/container/create` - Provision container
- `GET /api/sessions/:id/container/status` - Get container status
- `POST /api/sessions/:id/container/start` - Start container
- `POST /api/sessions/:id/container/stop` - Stop container
- `DELETE /api/sessions/:id/container` - Delete container

**Container Webhooks (requires session token):**
- `POST /api/container-webhooks/:sessionId/message` - Container posts message
- `GET /api/container-webhooks/:sessionId/messages` - Container fetches messages

**WebSocket:**
- `WS /ws/sessions/:sessionId?token=<jwt>&role=<container|client>` - Real-time streaming

### Container App

**Messages:**
- `GET /api/messages` - Fetch messages from main app
- `POST /api/messages` - Send user message and run agent

**Workspace:**
- `GET /api/workspace/files` - List workspace files
- `GET /api/workspace/files/*` - Read file content
- `PUT /api/workspace/files/*` - Write file content

**Health:**
- `GET /health` - Container health check

## Security

1. **Session Tokens**: JWT tokens authenticate containers with main app
2. **Token Validation**: All webhook endpoints validate tokens
3. **Container Isolation**: Each session runs in isolated Docker container
4. **Dangerous Mode**: Containers can execute code, but isolated from main server
5. **No Direct DB Access**: Containers only access database via webhooks

## Testing

### Local Testing (Without Dokploy)

1. Start main app:
   ```bash
   cd apps/main-app
   npm run dev
   ```

2. Start container app (simulating a container):
   ```bash
   cd apps/container-app
   
   # Set test environment
   export SESSION_ID=test-session
   export SESSION_TOKEN=test-token
   export MAIN_APP_URL=http://localhost:3000
   export MAIN_APP_WS_URL=ws://localhost:3000
   export WORKSPACE_PATH=/tmp/test-workspace
   
   npm run dev
   ```

3. Access:
   - Main App: http://localhost:3000
   - Container App: http://localhost:3001

### End-to-End Testing

1. Configure Dokploy server
2. Set Dokploy credentials in main app `.env`
3. Create new session in main app
4. Verify container is provisioned in Dokploy
5. Check container status shows "running"
6. Send message and verify:
   - Message appears in container UI
   - Agent responds
   - Message is stored in main app database
   - Real-time streaming works via WebSocket

## Troubleshooting

### Container won't start

- Check Dokploy logs for deployment errors
- Verify env vars are set correctly
- Check Docker image build succeeded
- Ensure workspace path is writable

### WebSocket not connecting

- Verify MAIN_APP_WS_URL is correct
- Check firewall allows WebSocket connections
- Ensure SESSION_TOKEN is valid

### Messages not persisting

- Check container has valid SESSION_TOKEN
- Verify main app webhook endpoint is accessible
- Check main app logs for webhook errors

### Agent not running

- Verify auth files are decoded correctly (check container logs)
- Ensure agent binaries are installed in container
- Check workspace path permissions

## Migration from Old Architecture

The old App.tsx has been preserved. To switch to the new architecture:

1. Update `main.tsx` to import `AppSimplified` instead of `App`
2. Test the new UI
3. Once stable, remove the old `App.tsx`

Old features not yet migrated:
- File editor (will be added to container app)
- Detailed/raw view modes (will be added to container app)
- Auto-title generation (needs webhook)

## Future Enhancements

1. **File Editor in Container**: Add file editor UI to container app
2. **Multiple View Modes**: Formatted/detailed/raw views in container
3. **Resource Monitoring**: Show container CPU/memory usage
4. **Auto-scaling**: Scale containers based on load
5. **Persistent Workspaces**: Mount persistent volumes for workspaces
6. **Container Logs**: Stream container logs to main app UI

## License

Same as original Codex WebApp project.
