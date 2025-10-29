# Codex WebApp

A full-stack TypeScript application integrating Claude AI (via ClaudeCodeSDK), DroidCLI, and Dokploy deployment capabilities.

## Project Structure

- **Backend** (`src/backend/`): Express server with authentication, workspace management, and AI agent integration
- **Frontend** (`src/frontend/`): React/Vite application with admin panel and deployment UI
- **Shared** (`src/shared/`): Common types and utilities

## Key Technologies

- TypeScript (Node.js backend + React frontend)
- Express.js for API routes
- Vite for frontend bundling
- SQLite database via better-sqlite3
- ClaudeCodeSDK for AI agent capabilities
- DroidCLI for additional AI providers
- Dokploy for deployment management

## Development

- Full-stack dev server runs on port 3000 (or next available port)
- In development, Vite middleware is integrated into Express
- Production mode serves pre-built static files from dist/client

## Authentication

- User authentication with JWT tokens
- Admin panel for user management
- Auth middleware protects routes

## Deployment

- Dokploy integration for application deployment
- Deployment panel in frontend UI
- Uses Dokploy API client for operations