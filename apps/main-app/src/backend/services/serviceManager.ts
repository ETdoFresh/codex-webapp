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

    // Add GitHub repository URL if provided
    if (settings.githubRepo) {
      envVars.GITHUB_REPO_URL = settings.githubRepo;
    }

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

    // Always configure container-app from codex-webapp repository
    // The user's repo URL is passed as GITHUB_REPO_URL env var (set above)
    console.log('[SERVICE] Configuring container-app from codex-webapp repository');

    await client.request({
      method: "POST",
      path: "/application.saveGithubProvider",
      body: {
        applicationId,
        owner: "ETdoFresh",
        repository: "codex-webapp",
        githubId: globalConfig.githubId || null,
        branch: "main",
        buildPath: "apps/container-app",
      },
    });

    // Use Dockerfile build type pointing to container-app Dockerfile
    await client.request({
      method: "POST",
      path: "/application.saveBuildType",
      body: {
        applicationId,
        buildType: "dockerfile",
        dockerfile: "Dockerfile",
        dockerContextPath: "./",
        dockerBuildStage: "",
      },
    });

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

    // Configure domain with HTTPS and Let's Encrypt
    const domainHost = process.env.DOKPLOY_DOMAIN_HOST || "codex-webapp.etdofresh.com";
    console.log(`[SERVICE] Creating domain for ${sessionId} on ${domainHost}`);

    await client.request({
      method: "POST",
      path: "/domain.create",
      body: {
        host: domainHost,
        path: `/${sessionId}`,
        port: 3001, // container-app runs on port 3001
        https: true,
        certificateType: "letsencrypt",
        applicationId,
        domainType: "application",
        stripPath: true,
      },
    });

    // Generate service URL with the configured domain
    const serviceUrl = `https://${domainHost}/${sessionId}`;

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
