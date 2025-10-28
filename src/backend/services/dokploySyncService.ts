import type {
  DeployConfig,
  DeployEnvVar,
  DeploySourceGit,
} from "../../shared/dokploy";
import { createDokployClient } from "./dokployClient";

const serializeEnv = (env: DeployEnvVar[] | undefined): string => {
  if (!env || env.length === 0) {
    return "";
  }

  return env
    .filter((entry) => entry.key && entry.key.trim().length > 0)
    .map((entry) => {
      const value = entry.value ?? "";
      return `${entry.key.trim()}=${value}`;
    })
    .join("\n");
};

const ensureApplication = async (
  config: DeployConfig,
  apiKey: string,
): Promise<{ config: DeployConfig; applicationId: string }> => {
  if (config.applicationId) {
    return { config, applicationId: config.applicationId };
  }

  if (!config.projectId) {
    throw new Error("Dokploy projectId is required to create an application.");
  }

  if (!config.appName || config.appName.trim().length === 0) {
    throw new Error("Application name is required to create a Dokploy application.");
  }

  const client = createDokployClient(config, apiKey);
  const body: Record<string, unknown> = {
    name: config.appName,
    appName: config.appName,
    projectId: config.projectId,
  };

  if (config.serverId) {
    body.serverId = config.serverId;
  }

  const result = (await client.request<{ applicationId?: string; app?: { applicationId?: string } }>(
    {
      method: "POST",
      path: "/application.create",
      body,
    },
  ));

  const applicationId =
    result?.applicationId ?? result?.app?.applicationId;

  if (!applicationId) {
    throw new Error("Dokploy did not return an applicationId when creating the application.");
  }

  return {
    config: {
      ...config,
      applicationId,
    },
    applicationId,
  };
};

const updateGeneralSettings = async (
  config: DeployConfig,
  apiKey: string,
  applicationId: string,
) => {
  const client = createDokployClient(config, apiKey);
  const payload: Record<string, unknown> = {
    applicationId,
  };

  if (config.appName && config.appName.trim().length > 0) {
    payload.name = config.appName;
    payload.appName = config.appName;
  }

  if (typeof config.autoDeploy === "boolean") {
    payload.autoDeploy = config.autoDeploy;
  }

  if (config.domain) {
    payload.title = config.domain;
  }

  if (config.resources?.cpuLimit !== undefined) {
    payload.cpuLimit = config.resources.cpuLimit;
  }
  if (config.resources?.cpuReservation !== undefined) {
    payload.cpuReservation = config.resources.cpuReservation;
  }
  if (config.resources?.memoryLimit !== undefined) {
    payload.memoryLimit = config.resources.memoryLimit;
  }
  if (config.resources?.memoryReservation !== undefined) {
    payload.memoryReservation = config.resources.memoryReservation;
  }
  if (config.resources?.replicas !== undefined) {
    payload.replicas = config.resources.replicas;
  }

  await client.request({
    method: "POST",
    path: "/application.update",
    body: payload,
  });
};

const updateEnvironment = async (
  config: DeployConfig,
  apiKey: string,
  applicationId: string,
) => {
  if (!config.env) {
    return;
  }

  const envBody = serializeEnv(config.env);
  const client = createDokployClient(config, apiKey);
  await client.request({
    method: "POST",
    path: "/application.saveEnvironment",
    body: {
      applicationId,
      env: envBody,
      buildArgs: "",
    },
  });
};

const updateBuildSettings = async (
  config: DeployConfig,
  apiKey: string,
  applicationId: string,
) => {
  if (!config.build) {
    return;
  }

  const client = createDokployClient(config, apiKey);
  await client.request({
    method: "POST",
    path: "/application.saveBuildType",
    body: {
      applicationId,
      buildType: config.build.buildType,
      dockerfile: config.build.dockerfile ?? null,
      dockerContextPath: config.build.dockerContextPath ?? null,
      dockerBuildStage: config.build.dockerBuildStage ?? null,
      publishDirectory: config.build.publishDirectory ?? null,
    },
  });
};

const updateGitProvider = async (
  config: DeployConfig,
  apiKey: string,
  applicationId: string,
  source: DeploySourceGit,
) => {
  const client = createDokployClient(config, apiKey);

  switch (source.provider) {
    case "github":
      await client.request({
        method: "POST",
        path: "/application.saveGithubProvider",
        body: {
          applicationId,
          repository: source.repository ?? null,
          owner: source.owner ?? null,
          branch: source.branch ?? null,
          buildPath: source.buildPath ?? null,
          githubId: source.projectId ?? null,
        },
      });
      break;
    case "gitlab":
      await client.request({
        method: "POST",
        path: "/application.saveGitlabProvider",
        body: {
          applicationId,
          gitlabRepository: source.repository ?? null,
          gitlabOwner: source.owner ?? null,
          gitlabBranch: source.branch ?? null,
          gitlabBuildPath: source.buildPath ?? null,
          gitlabId: source.projectId ?? null,
          gitlabProjectId: source.projectId ? Number(source.projectId) : null,
          gitlabPathNamespace: source.owner ?? null,
        },
      });
      break;
    case "bitbucket":
      await client.request({
        method: "POST",
        path: "/application.saveBitbucketProvider",
        body: {
          applicationId,
          bitbucketRepository: source.repository ?? null,
          bitbucketOwner: source.owner ?? null,
          bitbucketBranch: source.branch ?? null,
          bitbucketBuildPath: source.buildPath ?? null,
          bitbucketId: source.projectId ?? null,
        },
      });
      break;
    case "custom":
    default:
      await client.request({
        method: "POST",
        path: "/application.saveGitProdiver",
        body: {
          applicationId,
          customGitUrl: source.repository ?? null,
          customGitBranch: source.branch ?? null,
          customGitBuildPath: source.buildPath ?? null,
          customGitSSHKeyId: source.projectId ?? null,
        },
      });
  }
};

const updateWorkspaceSource = async (
  config: DeployConfig,
  apiKey: string,
  applicationId: string,
) => {
  if (config.source.type !== "workspace") {
    return;
  }

  if (!config.source.artifactUrl) {
    throw new Error(
      "Workspace deployment requires an uploaded artifact URL. Upload the workspace before syncing.",
    );
  }

  const client = createDokployClient(config, apiKey);
  await client.request({
    method: "POST",
    path: "/application.saveGitProdiver",
    body: {
      applicationId,
      customGitUrl: config.source.artifactUrl,
      customGitBranch: config.source.artifactKey ?? "workspace-upload",
      customGitBuildPath: config.build?.dockerContextPath ?? ".",
      customGitSSHKeyId: null,
    },
  });
};

const updateTraefik = async (
  config: DeployConfig,
  apiKey: string,
  applicationId: string,
) => {
  if (!config.traefikConfig || config.traefikConfig.trim().length === 0) {
    return;
  }

  const client = createDokployClient(config, apiKey);
  await client.request({
    method: "POST",
    path: "/application.updateTraefikConfig",
    body: {
      applicationId,
      traefikConfig: config.traefikConfig,
    },
  });
};

export const synchronizeDokployApplication = async (
  config: DeployConfig,
  apiKey: string,
): Promise<{
  config: DeployConfig;
  applicationId: string;
}> => {
  const ensured = await ensureApplication(config, apiKey);
  const applicationId = ensured.applicationId;
  const mergedConfig = ensured.config;

  await updateGeneralSettings(mergedConfig, apiKey, applicationId);
  await updateEnvironment(mergedConfig, apiKey, applicationId);
  await updateBuildSettings(mergedConfig, apiKey, applicationId);

  if (mergedConfig.source.type === "git") {
    await updateGitProvider(mergedConfig, apiKey, applicationId, mergedConfig.source);
  } else {
    await updateWorkspaceSource(mergedConfig, apiKey, applicationId);
  }

  await updateTraefik(mergedConfig, apiKey, applicationId);

  return {
    config: {
      ...mergedConfig,
      applicationId,
      lastSyncedAt: new Date().toISOString(),
    },
    applicationId,
  };
};
