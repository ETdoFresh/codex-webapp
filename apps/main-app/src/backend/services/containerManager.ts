import database from "../db";
import { createDokployClient } from "./dokployClient";
import type { DeployConfig } from "../../shared/dokploy";
import type { SessionSettingsRecord } from "../types/database";
import { generateSessionToken } from "./sessionTokenService";

type CreateContainerOptions = {
  sessionId: string;
  settings: SessionSettingsRecord;
  userId: string;
  globalConfig: DeployConfig;
  apiKey: string;
  authEnvVars: Record<string, string>;
};

type ContainerStatus = {
  status: "creating" | "running" | "stopped" | "error";
  url?: string;
  error?: string;
};

/**
 * Creates a new Dokploy application container for a session
 */
export async function createContainer(
  options: CreateContainerOptions,
): Promise<void> {
  const { sessionId, settings, userId, globalConfig, apiKey, authEnvVars } = options;

  try {
    // Update container status to "creating"
    database.upsertSessionContainer({
      sessionId,
      dokployAppId: null,
      containerUrl: null,
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

    // Generate session token for container authentication
    const sessionToken = generateSessionToken(sessionId, userId);

    // Create application in Dokploy
    const createBody: Record<string, unknown> = {
      name: sessionId,
      appName: sessionId,
      projectId: globalConfig.projectId,
    };

    if (globalConfig.serverId) {
      createBody.serverId = globalConfig.serverId;
    }

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
      await client.request({
        method: "POST",
        path: "/application.saveGithubProvider",
        body: {
          applicationId,
          repository: settings.githubRepo,
          branch: buildSettings.branch || "main",
          buildPath: buildSettings.buildPath || "./",
        },
      });

      // Set build type
      await client.request({
        method: "POST",
        path: "/application.saveBuildType",
        body: {
          applicationId,
          buildType: buildSettings.buildType || "nixpacks",
          dockerfile: settings.dockerfilePath || undefined,
        },
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

    // Generate container URL (assuming Dokploy pattern)
    const containerUrl = `${globalConfig.baseUrl.replace(/\/api$/, "")}/${sessionId}`;

    // Update container record with success
    database.upsertSessionContainer({
      sessionId,
      dokployAppId: applicationId,
      containerUrl,
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
    database.upsertSessionContainer({
      sessionId,
      dokployAppId: null,
      containerUrl: null,
      status: "error",
      errorMessage,
    });
    throw error;
  }
}

/**
 * Gets the current status of a session container
 */
export async function getContainerStatus(
  sessionId: string,
): Promise<ContainerStatus | null> {
  const container = database.getSessionContainer(sessionId);
  if (!container) {
    return null;
  }

  return {
    status: container.status,
    url: container.containerUrl || undefined,
    error: container.errorMessage || undefined,
  };
}

/**
 * Stops a running container
 */
export async function stopContainer(
  sessionId: string,
  globalConfig: DeployConfig,
  apiKey: string,
): Promise<void> {
  const container = database.getSessionContainer(sessionId);
  if (!container || !container.dokployAppId) {
    throw new Error("Container not found");
  }

  const client = createDokployClient(globalConfig, apiKey);

  await client.request({
    method: "POST",
    path: "/application.stop",
    body: {
      applicationId: container.dokployAppId,
    },
  });

  database.upsertSessionContainer({
    sessionId,
    dokployAppId: container.dokployAppId,
    containerUrl: container.containerUrl,
    status: "stopped",
    errorMessage: null,
  });
}

/**
 * Starts a stopped container
 */
export async function startContainer(
  sessionId: string,
  globalConfig: DeployConfig,
  apiKey: string,
): Promise<void> {
  const container = database.getSessionContainer(sessionId);
  if (!container || !container.dokployAppId) {
    throw new Error("Container not found");
  }

  const client = createDokployClient(globalConfig, apiKey);

  await client.request({
    method: "POST",
    path: "/application.start",
    body: {
      applicationId: container.dokployAppId,
    },
  });

  database.upsertSessionContainer({
    sessionId,
    dokployAppId: container.dokployAppId,
    containerUrl: container.containerUrl,
    status: "running",
    errorMessage: null,
  });
}

/**
 * Deletes a container from Dokploy
 */
export async function deleteContainer(
  sessionId: string,
  globalConfig: DeployConfig,
  apiKey: string,
): Promise<void> {
  const container = database.getSessionContainer(sessionId);
  if (!container || !container.dokployAppId) {
    return;
  }

  const client = createDokployClient(globalConfig, apiKey);

  await client.request({
    method: "DELETE",
    path: "/application.delete",
    body: {
      applicationId: container.dokployAppId,
    },
  });

  database.deleteSessionContainer(sessionId);
}

/**
 * Gets logs for a container
 */
export async function getContainerLogs(
  sessionId: string,
  globalConfig: DeployConfig,
  apiKey: string,
): Promise<string> {
  const container = database.getSessionContainer(sessionId);
  if (!container || !container.dokployAppId) {
    throw new Error("Container not found");
  }

  const client = createDokployClient(globalConfig, apiKey);

  const logs = await client.request<{ logs?: string }>({
    method: "GET",
    path: "/application.logs",
    query: {
      applicationId: container.dokployAppId,
    },
  });

  return logs?.logs || "";
}
