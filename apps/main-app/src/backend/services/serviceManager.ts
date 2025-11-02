import database from "../db";
import { createDokployClient } from "./dokployClient";
import type { DeployConfig } from "../../shared/dokploy";
import type { SessionSettingsRecord } from "../types/database";
import { generateSessionToken } from "./sessionTokenService";

type CreateServiceOptions = {
  sessionId: string;
  settings: SessionSettingsRecord;
  userId: string;
  globalConfig: DeployConfig;
  apiKey: string;
  authEnvVars: Record<string, string>;
};

type ServiceStatus = {
  status: "creating" | "running" | "stopped" | "error";
  url?: string;
  error?: string;
};

/**
 * Creates a new Dokploy application service for a session
 */
export async function createService(
  options: CreateServiceOptions,
): Promise<void> {
  const { sessionId, settings, userId, globalConfig, apiKey, authEnvVars } = options;

  try {
    // Update service status to "creating"
    database.upsertSessionService({
      sessionId,
      dokployAppId: null,
      serviceUrl: null,
      status: "creating",
      errorMessage: null,
    });

    const client = createDokployClient(globalConfig, apiKey);

    // Parse settings
    const customEnvVars = JSON.parse(settings.customEnvVars) as Record<
      string,
      string
    >;
    const buildSettings = JSON.parse(settings.buildSettings) as Record<
      string,
      unknown
    >;

    // Generate session token for service authentication
    const sessionToken = generateSessionToken(sessionId, userId);

    // Get or create environment ID for the project
    // If not configured, query Dokploy for environments and use the first one
    let environmentId: string | undefined = globalConfig.environmentId;

    if (!environmentId) {
      console.log('[SERVICE] No environmentId in config, querying Dokploy for environments...');
      try {
        const environments = await client.request<any[]>({
          method: "GET",
          path: `/project.${globalConfig.projectId}.getEnvironments`,
        });
        if (environments && environments.length > 0) {
          environmentId = environments[0].environmentId;
          console.log(`[SERVICE] Using first environment: ${environmentId}`);
        }
      } catch (error) {
        console.error('[SERVICE] Failed to query environments:', error);
        console.log('[SERVICE] Will attempt to create application without environmentId');
      }
    }

    // Create application in Dokploy
    const createBody: Record<string, unknown> = {
      name: sessionId,
      appName: sessionId,
      projectId: globalConfig.projectId,
    };

    // Only add environmentId if we have one
    if (environmentId) {
      createBody.environmentId = environmentId;
    }

    if (globalConfig.serverId) {
      createBody.serverId = globalConfig.serverId;
    }

    console.log('[SERVICE] Creating Dokploy application with body:', JSON.stringify(createBody, null, 2));

    const result = await client.request<{
      applicationId?: string;
      app?: { applicationId?: string };
    }>({
      method: "POST",
      path: "/application.create",
      body: createBody,
    });

    const applicationId = result?.applicationId ?? result?.app?.applicationId;

    if (!applicationId) {
      throw new Error("Dokploy did not return an applicationId");
    }

    // Determine main app URL
    const mainAppUrl = process.env.MAIN_APP_URL || "http://localhost:3000";
    const mainAppWsUrl = process.env.MAIN_APP_WS_URL || mainAppUrl.replace(/^http/, "ws");

    // Prepare environment variables
    const envVars: Record<string, string> = {
      SESSION_ID: sessionId,
      SESSION_TOKEN: sessionToken,
      MAIN_APP_URL: mainAppUrl,
      MAIN_APP_WS_URL: mainAppWsUrl,
      WORKSPACE_PATH: "/workspace",
      ...authEnvVars,
      ...customEnvVars,
    };

    // Convert env vars to Dokploy format
    const envString = Object.entries(envVars)
      .map(([key, value]) => `${key}=${value}`)
      .join("\n");

    // Update environment variables
    await client.request({
      method: "POST",
      path: "/application.saveEnvironment",
      body: {
        applicationId,
        env: envString,
        buildArgs: "",
      },
    });

    // Configure build settings if GitHub repo is provided
    if (settings.githubRepo) {
      // Extract owner and repository name from GitHub URL
      // Format: https://github.com/owner/repo or git@github.com:owner/repo.git
      const githubUrlMatch = settings.githubRepo.match(/github\.com[:/]([^/]+)\/([^/.]+)(?:\.git)?$/);
      const owner = githubUrlMatch?.[1];
      const repository = githubUrlMatch?.[2];

      if (!owner || !repository) {
        throw new Error(`Invalid GitHub repository URL format: ${settings.githubRepo}`);
      }

      await client.request({
        method: "POST",
        path: "/application.saveGithubProvider",
        body: {
          applicationId,
          owner,
          repository,
          githubId: globalConfig.githubId || null,
          branch: buildSettings.branch || "main",
          buildPath: buildSettings.buildPath || "./",
        },
      });

      // Set build type to dockerfile with default Dockerfile for TypeScript
      const dockerfileLines = [
        "FROM node:20-slim",
        "WORKDIR /app",
        "",
        "# Copy repository contents",
        "COPY . .",
        "",
        "# If package.json doesn't exist, create a simple TypeScript Hello World app",
        "RUN if [ ! -f package.json ]; then \\",
        "  echo '{' > package.json && \\",
        "  echo '  \"name\": \"hello-world-typescript\",' >> package.json && \\",
        "  echo '  \"version\": \"1.0.0\",' >> package.json && \\",
        "  echo '  \"scripts\": {' >> package.json && \\",
        "  echo '    \"dev\": \"ts-node src/index.ts\",' >> package.json && \\",
        "  echo '    \"start\": \"ts-node src/index.ts\"' >> package.json && \\",
        "  echo '  },' >> package.json && \\",
        "  echo '  \"dependencies\": {' >> package.json && \\",
        "  echo '    \"express\": \"^4.18.2\",' >> package.json && \\",
        "  echo '    \"@types/express\": \"^4.17.17\",' >> package.json && \\",
        "  echo '    \"typescript\": \"^5.0.0\",' >> package.json && \\",
        "  echo '    \"ts-node\": \"^10.9.1\"' >> package.json && \\",
        "  echo '  }' >> package.json && \\",
        "  echo '}' >> package.json && \\",
        "  mkdir -p src && \\",
        "  echo \"import express from 'express';\" > src/index.ts && \\",
        "  echo \"const app = express();\" >> src/index.ts && \\",
        "  echo \"const port = process.env.PORT || 3000;\" >> src/index.ts && \\",
        "  echo \"app.get('/', (req, res) => {\" >> src/index.ts && \\",
        "  echo \"  res.send('<h1>Hello World from TypeScript!</h1><p>This is a generated app.</p>');\" >> src/index.ts && \\",
        "  echo \"});\" >> src/index.ts && \\",
        "  echo \"app.listen(port, () => console.log(\\\\\\`Server running on port \\\\\\${port}\\\\\\`));\" >> src/index.ts; \\",
        "fi",
        "",
        "# Install dependencies",
        "RUN npm install",
        "",
        "CMD [\"npm\", \"run\", \"dev\"]"
      ];
      const defaultDockerfile = dockerfileLines.join("\n");

      // Only pass dockerfile field if user explicitly provided a path
      // Otherwise, let Dokploy use default behavior or nixpacks
      const buildTypeBody: Record<string, unknown> = {
        applicationId,
        dockerContextPath: "./",
        dockerBuildStage: "",
      };

      if (settings.dockerfilePath) {
        // User provided a custom Dockerfile path
        buildTypeBody.buildType = "dockerfile";
        buildTypeBody.dockerfile = settings.dockerfilePath;
      } else {
        // Use nixpacks which will auto-detect and build the app
        buildTypeBody.buildType = "nixpacks";
      }

      await client.request({
        method: "POST",
        path: "/application.saveBuildType",
        body: buildTypeBody,
      });
    }

    // Configure general settings
    await client.request({
      method: "POST",
      path: "/application.update",
      body: {
        applicationId,
        name: sessionId,
        appName: sessionId,
        autoDeploy: false,
      },
    });

    // Generate service URL (assuming Dokploy pattern)
    const serviceUrl = `${globalConfig.baseUrl.replace(/\/api$/, "")}/${sessionId}`;

    // Update service record with success
    database.upsertSessionService({
      sessionId,
      dokployAppId: applicationId,
      serviceUrl,
      status: "running",
      errorMessage: null,
    });

    // Deploy the application
    await client.request({
      method: "POST",
      path: "/application.deploy",
      body: {
        applicationId,
      },
    });
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    database.upsertSessionService({
      sessionId,
      dokployAppId: null,
      serviceUrl: null,
      status: "error",
      errorMessage,
    });
    throw error;
  }
}

/**
 * Gets the current status of a session service
 */
export async function getServiceStatus(
  sessionId: string,
): Promise<ServiceStatus | null> {
  const service = database.getSessionService(sessionId);
  if (!service) {
    return null;
  }

  return {
    status: service.status,
    url: service.serviceUrl || undefined,
    error: service.errorMessage || undefined,
  };
}

/**
 * Stops a running service
 */
export async function stopService(
  sessionId: string,
  globalConfig: DeployConfig,
  apiKey: string,
): Promise<void> {
  const service = database.getSessionService(sessionId);
  if (!service || !service.dokployAppId) {
    throw new Error("Service not found");
  }

  const client = createDokployClient(globalConfig, apiKey);

  await client.request({
    method: "POST",
    path: "/application.stop",
    body: {
      applicationId: service.dokployAppId,
    },
  });

  database.upsertSessionService({
    sessionId,
    dokployAppId: service.dokployAppId,
    serviceUrl: service.serviceUrl,
    status: "stopped",
    errorMessage: null,
  });
}

/**
 * Starts a stopped service
 */
export async function startService(
  sessionId: string,
  globalConfig: DeployConfig,
  apiKey: string,
): Promise<void> {
  const service = database.getSessionService(sessionId);
  if (!service || !service.dokployAppId) {
    throw new Error("Service not found");
  }

  const client = createDokployClient(globalConfig, apiKey);

  await client.request({
    method: "POST",
    path: "/application.start",
    body: {
      applicationId: service.dokployAppId,
    },
  });

  database.upsertSessionService({
    sessionId,
    dokployAppId: service.dokployAppId,
    serviceUrl: service.serviceUrl,
    status: "running",
    errorMessage: null,
  });
}

/**
 * Deletes a service from Dokploy
 */
export async function deleteService(
  sessionId: string,
  globalConfig: DeployConfig,
  apiKey: string,
): Promise<void> {
  const service = database.getSessionService(sessionId);
  if (!service || !service.dokployAppId) {
    return;
  }

  const client = createDokployClient(globalConfig, apiKey);

  await client.request({
    method: "DELETE",
    path: "/application.delete",
    body: {
      applicationId: service.dokployAppId,
    },
  });

  database.deleteSessionService(sessionId);
}

/**
 * Gets logs for a service
 */
export async function getServiceLogs(
  sessionId: string,
  globalConfig: DeployConfig,
  apiKey: string,
): Promise<string> {
  const service = database.getSessionService(sessionId);
  if (!service || !service.dokployAppId) {
    throw new Error("Service not found");
  }

  const client = createDokployClient(globalConfig, apiKey);

  const logs = await client.request<{ logs?: string }>({
    method: "GET",
    path: "/application.logs",
    query: {
      applicationId: service.dokployAppId,
    },
  });

  return logs?.logs || "";
}
