# Migration Guide: Monolithic → Containerized Architecture

## Summary of Changes

This refactor splits the Codex WebApp into two applications:

1. **Main App** (`apps/main-app/`)
   - Manages user sessions and authentication
   - Single SQLite database (source of truth)
   - Session list UI
   - Orchestrates container creation via Dokploy
   - WebSocket server for real-time streaming
   - Webhook endpoints for container → main app communication

2. **Container App** (`apps/container-app/`)
   - Runs one session per container
   - Executes code assistants (Codex/Claude/Droid)
   - Single-session UI (embedded via iframe)
   - Streams output to main app
   - Posts completed messages to main app

## What Changed

### Backend Changes

**Main App:**
- ✅ Added `sessionTokenService.ts` - JWT token generation/validation
- ✅ Added `websocketBridge.ts` - WebSocket server for streaming
- ✅ Added `containerWebhookRoutes.ts` - Container → main app webhooks
- ✅ Updated `containerManager.ts` - Generates tokens, passes env vars
- ✅ Updated `index.ts` - Initializes WebSocket server

**Container App (NEW):**
- ✅ `mainAppClient.ts` - HTTP + WebSocket client to main app
- ✅ `agentRunner.ts` - Runs code assistants in isolation
- ✅ `messageRoutes.ts` - Handles user input, triggers agents
- ✅ `workspaceRoutes.ts` - File operations in workspace
- ✅ `validateToken.ts` - Validates session token

### Frontend Changes

**Main App:**
- ✅ Added `ContainerIframe.tsx` - Embeds container UI
- ✅ Added `SessionList.tsx` - Session list with container status
- ✅ Added `AppSimplified.tsx` - New main UI (3 panels: header, sidebar, iframe)
- ⚠️  Old `App.tsx` preserved (3071 lines) - **needs manual removal after testing**

**Container App (NEW):**
- ✅ `App.tsx` - Single-session chat UI
- ✅ `useMainAppBridge.ts` - postMessage communication
- ✅ `useWebSocket.ts` - WebSocket streaming

### Infrastructure Changes

- ✅ Monorepo structure with npm workspaces
- ✅ Shared types package (`apps/shared/`)
- ✅ Dockerfile for container app
- ✅ `container-init.sh` - Decodes auth files on startup
- ✅ New dependencies: `ws`, `jsonwebtoken`, `node-fetch`

## Breaking Changes

### For End Users

1. **Container Provisioning Required**
   - Each session now requires a Docker container
   - Must configure Dokploy before creating sessions
   - Container startup takes ~30-60 seconds

2. **No Direct Chat UI in Main App**
   - Main app no longer renders messages directly
   - All chat happens inside container iframe
   - View modes (formatted/detailed/raw) moved to container

### For Developers

1. **Message Storage Flow Changed**
   ```
   OLD: Frontend → Backend → DB
   NEW: Container → Webhook → Main App → DB
   ```

2. **Real-time Streaming**
   ```
   OLD: SSE from main app
   NEW: WebSocket from main app (container streams to it)
   ```

3. **Authentication**
   - Containers authenticate with JWT tokens
   - Tokens generated when container is created
   - Tokens expire after 7 days (configurable)

## Migration Steps

### Step 1: Update Environment Variables

Add to your `.env`:
```bash
JWT_SECRET=<generate-random-secret>
MAIN_APP_URL=http://localhost:3000
MAIN_APP_WS_URL=ws://localhost:3000
```

### Step 2: Install Dependencies

```bash
cd /path/to/codex-webapp
npm install
```

### Step 3: Update Main App Frontend

**Option A: Use Simplified App (Recommended)**
```typescript
// apps/main-app/src/frontend/src/main.tsx
import AppSimplified from "./AppSimplified";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AppSimplified />
  </React.StrictMode>
);
```

**Option B: Keep Old App (Temporary)**
- Old App.tsx still works for non-containerized sessions
- Use this for gradual migration
- Will need manual updates to support iframe view

### Step 4: Build Container Image

```bash
cd apps/container-app
npm run build
docker build -t codex-container-app:latest .
```

### Step 5: Configure Dokploy

1. Set up Dokploy server
2. Create a project for Codex containers
3. Add Dokploy credentials to main app `.env`
4. Test connection via Admin → Dokploy panel

### Step 6: Test Container Creation

1. Start main app: `npm run dev:main`
2. Create new session
3. Click "Create Container" (or automatic on session create)
4. Wait for container to provision
5. Verify iframe loads and chat works

## Rollback Plan

If you need to rollback:

1. **Keep Old App.tsx**: Don't delete it yet
2. **Revert main.tsx**: Import `App` instead of `AppSimplified`
3. **Disable Container Routes**: Comment out container webhook routes
4. **Old Sessions Work**: Existing sessions continue to work without containers

## Testing Checklist

- [ ] Main app starts without errors
- [ ] Can create new session
- [ ] Session appears in sidebar
- [ ] Container status shows "creating" → "running"
- [ ] Container iframe loads
- [ ] Can send message in container
- [ ] Agent responds
- [ ] Message persists in database
- [ ] WebSocket shows "connected"
- [ ] Real-time streaming works
- [ ] Can switch between sessions
- [ ] Can delete session
- [ ] Container is removed from Dokploy

## Common Issues

### "Container not properly configured"
- Container missing SESSION_ID or SESSION_TOKEN
- Check containerManager.ts passes env vars correctly
- Verify Dokploy deployment logs

### "Failed to post message to main app"
- Container can't reach main app
- Check MAIN_APP_URL is accessible from container
- Verify network/firewall settings
- Check session token is valid

### "WebSocket not connecting"
- MAIN_APP_WS_URL incorrect
- WebSocket port blocked
- Check browser console for errors

### "Container status stuck on 'creating'"
- Dokploy deployment failed
- Check Dokploy logs
- Verify Docker image exists
- Check container resource limits

## Performance Considerations

### Before (Monolithic)
- Single server handles all sessions
- ~100MB RAM per session
- Shared agent processes
- Risk: One bad command affects all users

### After (Containerized)
- One container per session
- ~200-300MB RAM per container (includes Node + Docker overhead)
- Isolated agent processes
- Benefit: Complete isolation, dangerous mode safe

### Resource Planning

For N concurrent sessions:
- **RAM**: ~300MB × N + 500MB (main app)
- **CPU**: ~0.5 core × N + 0.5 (main app)
- **Disk**: ~100MB × N (workspaces) + 50MB (DB)

Example: 10 sessions = ~3.5GB RAM, ~5.5 CPU cores

## Next Steps

1. **Test in Development**: Use simplified app, create a few sessions
2. **Monitor Performance**: Watch Docker stats, check logs
3. **Gradual Rollout**: Run both old and new apps in parallel
4. **Full Migration**: Once stable, remove old App.tsx
5. **Production Deploy**: Build and deploy container images to registry

## Support

- See `REFACTOR_README.md` for detailed architecture
- Check container logs: `docker logs <container-id>`
- Check main app logs for webhook errors
- Test locally before deploying to production

## Notes

- Old message flow still works for existing sessions
- New sessions automatically use containers
- Database schema unchanged (backward compatible)
- Can run old and new architecture simultaneously
