export type DeployAuthMethod = "x-api-key" | "authorization";

export type DeployEnvVar = {
  key: string;
  value?: string;
  masked?: boolean;
  isSecret?: boolean;
};

export type DeploySourceGit = {
  type: "git";
  provider: "github" | "gitlab" | "bitbucket" | "custom";
  repository?: string;
  owner?: string;
  branch?: string;
  buildPath?: string;
  projectId?: string;
};

export type DeploySourceWorkspace = {
  type: "workspace";
  lastUploadedAt?: string | null;
  artifactUrl?: string | null;
  artifactKey?: string | null;
  expiresAt?: string | null;
};

export type DeploySource = DeploySourceGit | DeploySourceWorkspace;

export type DeployBuildConfig = {
  buildType: "dockerfile" | "heroku_buildpacks" | "paketo_buildpacks" | "nixpacks" | "static";
  dockerfile?: string | null;
  dockerContextPath?: string | null;
  dockerBuildStage?: string | null;
  publishDirectory?: string | null;
};

export type DeployResources = {
  cpuLimit?: number | null;
  cpuReservation?: number | null;
  memoryLimit?: number | null;
  memoryReservation?: number | null;
  replicas?: number | null;
};

export type DeployConfig = {
  baseUrl: string;
  authMethod: DeployAuthMethod;
  projectId?: string;
  environmentId?: string;
  applicationId?: string;
  serverId?: string;
  githubId?: string;
  appName?: string;
  domain?: string;
  port?: number;
  traefikConfig?: string;
  autoDeploy?: boolean;
  env?: DeployEnvVar[];
  source: DeploySource;
  build?: DeployBuildConfig;
  resources?: DeployResources;
  lastSyncedAt?: string;
};

export type DeployConfigResponse = DeployConfig & {
  hasApiKey: boolean;
};
