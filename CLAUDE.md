# Codex WebApp - Claude AI Documentation

This document provides information for AI assistants working on this project.

## Project Overview

Codex WebApp is a containerized web application platform that creates isolated development environments using Dokploy for deployment management. The project uses a monorepo structure with workspace-based architecture.

## Project Structure

```
codex-webapp/
├── apps/
│   └── main-app/           # Main application
│       ├── src/
│       │   ├── backend/    # Node.js/Express backend
│       │   │   ├── db.ts   # SQLite database layer
│       │   │   ├── routes/ # API routes
│       │   │   └── services/
│       │   │       ├── serviceManager.ts  # Dokploy service management
│       │   │       ├── dokployClient.ts   # Dokploy API client
│       │   │       └── sessionTokenService.ts
│       │   └── frontend/   # React frontend
│       │       └── src/
│       └── var/
│           └── chat.db     # Main SQLite database (IMPORTANT: This is the actual DB location!)
├── apps/shared/            # Shared types and utilities
└── package.json
```

## Database Location

**IMPORTANT**: The actual database file is located at:
```
/Users/etgarcia/temp/codex-webapp/apps/main-app/var/chat.db
```

NOT at `apps/main-app/codex-webapp.db` (which is an empty placeholder).

### Key Database Tables

- `deploy_configs` - Stores Dokploy configuration (base URL, project ID, environment ID, API keys)
- `sessions` - User sessions and workspace information
- `session_settings` - Session-specific configuration
- `messages` - Chat/interaction history

## Running the Application

```bash
cd /Users/etgarcia/temp/codex-webapp
npm run dev
```

This starts the development server on `http://localhost:3000`.

The server logs are piped to `/tmp/server-output.log` for debugging.

## Dokploy Integration

### Overview

The application integrates with Dokploy to create containerized services for each session. Dokploy handles:
- Building applications from GitHub repositories using Nixpacks or Dockerfiles
- Deploying containers
- Managing application lifecycle (start, stop, delete)

### Configuration

Dokploy configuration is stored in the `deploy_configs` table:

```sql
SELECT * FROM deploy_configs WHERE id = 'default';
```

Fields:
- `id` - Configuration identifier (usually 'default')
- `config` - JSON configuration with:
  - `baseUrl` - Dokploy API endpoint (e.g., `https://dokploy.etdofresh.com/api`)
  - `authMethod` - Authentication method ('x-api-key' or 'authorization')
  - `projectId` - Dokploy project ID
  - `environmentId` - Dokploy environment ID
  - `githubId` - GitHub App integration ID
- `api_key_cipher` - Base64-encoded API key (may be encrypted with GCM)
- `api_key_iv` - Initialization vector for GCM encryption (if used)
- `api_key_tag` - Authentication tag for GCM encryption (if used)

### Service Creation Flow

1. User creates a new session with optional GitHub repository
2. `serviceManager.createService()` is called (`apps/main-app/src/backend/services/serviceManager.ts`)
3. Creates Dokploy application via API:
   - POST `/application.create` - Creates application
   - POST `/application.saveEnvironment` - Sets environment variables
   - POST `/application.saveGithubProvider` - Configures GitHub source (if provided)
   - POST `/application.saveBuildType` - Sets build type (nixpacks or dockerfile)
   - POST `/application.deploy` - Triggers deployment

### Build Types

**Nixpacks (Default)**:
- Auto-detects project type from repository contents
- Automatically configures build based on `package.json`, requirements files, etc.
- Used when no custom Dockerfile path is provided
- Requires actual code in the repository (package.json, source files)

**Dockerfile**:
- Only used when `settings.dockerfilePath` is explicitly provided
- The `dockerfile` field expects a **filepath**, not content
- Default behavior now uses Nixpacks instead of generating Dockerfiles

## Checking Deployment Status

### Method 1: Query Application Status via API

```javascript
const Database = require('better-sqlite3');
const db = new Database('/Users/etgarcia/temp/codex-webapp/apps/main-app/var/chat.db');

// Get Dokploy configuration
const configRow = db.prepare('SELECT * FROM deploy_configs WHERE id = ?').get('default');
const config = JSON.parse(configRow.config);

// Decrypt API key (old encryption without IV/tag)
const apiKey = Buffer.from(configRow.api_key_cipher, 'base64').toString('utf8');

// Query application status
const applicationId = 'YOUR_APPLICATION_ID';
const url = `${config.baseUrl}/application.one?applicationId=${applicationId}`;

fetch(url, {
  headers: {
    'accept': 'application/json',
    'x-api-key': apiKey
  }
})
.then(res => res.json())
.then(data => {
  console.log('Status:', data.applicationStatus);  // e.g., "done", "running", "error"
  console.log('Build Type:', data.buildType);      // e.g., "nixpacks"
  console.log('Repository:', data.owner + '/' + data.repository);
  console.log('Deployments:', data.deployments);
});
```

### Method 2: Check Server Logs

The main application logs Dokploy operations:

```bash
tail -f /tmp/server-output.log | grep -E "\[SERVICE\]|\[DEPLOY"
```

Look for:
- `[SERVICE] Creating Dokploy application with body:` - Application creation
- `[DEPLOY]` - Deployment-related logs
- Session IDs and Application IDs in the logs

### Method 3: Use Chrome DevTools MCP

Navigate to `http://localhost:3000` and check the UI:
- Green indicator (🟢) = Service running
- Yellow indicator (🟡) = Service creating
- Red indicator (🔴) = Service error

### Application Status Values

- `idle` - Application created but not deployed
- `running` - Currently deploying
- `done` - Deployment completed successfully
- `error` - Deployment failed

### Deployment Object Structure

```json
{
  "deploymentId": "...",
  "status": "done",
  "logPath": "/etc/dokploy/logs/...",
  "applicationId": "...",
  "createdAt": "...",
  "startedAt": "...",
  "finishedAt": "...",
  "errorMessage": null
}
```

## Common Issues and Solutions

### Issue: ENAMETOOLONG Error

**Problem**: Passing Dockerfile content instead of filepath to `dockerfile` field.

**Solution**: Use `buildType: "nixpacks"` when no custom Dockerfile path is provided, or pass the actual filepath (not content) when using Dockerfile buildType.

Fixed in `serviceManager.ts:206-227`.

### Issue: Nixpacks "unable to generate build plan"

**Problem**: Repository is empty or missing required files.

**Solution**: Ensure repository has proper files:
- `package.json` for Node.js projects
- `requirements.txt` for Python projects
- Source code files

### Issue: Database table not found

**Problem**: Using wrong database path.

**Solution**: Use `/Users/etgarcia/temp/codex-webapp/apps/main-app/var/chat.db`, not `codex-webapp.db`.

## Recent Changes

### 2025-11-02: Nixpacks Migration

- Changed default build strategy from Dockerfile to Nixpacks
- Removed EXPOSE 3000 from default Dockerfile template
- Fixed bug where Dockerfile content was passed as filepath
- Now properly uses Nixpacks for auto-detection when no custom Dockerfile path provided

### Repository Setup

Test repository: `https://github.com/ETdoFresh/hello-world-typescript`

Added files:
- `package.json` - Express dependency and start script
- `index.js` - Styled Hello World server with health check endpoint

## Development Workflow

1. Make changes to source code
2. Server auto-restarts via `tsx watch`
3. Check logs in `/tmp/server-output.log`
4. Test via `http://localhost:3000`
5. Create sessions to test Dokploy integration

## Useful Commands

```bash
# View server logs
tail -f /tmp/server-output.log

# Check database
sqlite3 /Users/etgarcia/temp/codex-webapp/apps/main-app/var/chat.db

# Kill server processes
lsof -ti:3000,3001,3002,3003,3004 | xargs kill -9

# Start dev server
cd /Users/etgarcia/temp/codex-webapp && npm run dev
```

## API Endpoints

### Dokploy API

Base URL: `https://dokploy.etdofresh.com/api`

Key endpoints:
- POST `/application.create` - Create new application
- POST `/application.deploy` - Trigger deployment
- GET `/application.one?applicationId=...` - Get application details
- GET `/deployment.logs?deploymentId=...` - Get deployment logs (often returns 404)
- POST `/application.saveEnvironment` - Update environment variables
- POST `/application.saveGithubProvider` - Configure GitHub source
- POST `/application.saveBuildType` - Set build configuration

Authentication: `x-api-key` header with API key from `deploy_configs` table.

## Notes for AI Assistants

- Always use the correct database path: `apps/main-app/var/chat.db`
- Check server logs for debugging: `/tmp/server-output.log`
- Deployment logs API often returns 404 - use `application.one` endpoint instead to check status
- Nixpacks requires actual code files in the repository
- Session IDs are UUIDs used as application names in Dokploy
