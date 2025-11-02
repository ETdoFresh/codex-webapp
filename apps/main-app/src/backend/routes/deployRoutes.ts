import { Router, type Request, type Response } from "express";
import fs from "node:fs";
import { z } from "zod";
import { database } from "../db";
import type { DeployConfig, DeployEnvVar } from "../../shared/dokploy";
import { createDokployClient } from "../services/dokployClient";
import { synchronizeDokployApplication } from "../services/dokploySyncService";
import {
  createWorkspaceArchive,
  getArtifactPath,
} from "../services/workspaceArchiveService";
import { requireAdmin } from "../middleware/auth";

const router = Router();
router.use(requireAdmin);

const envVarSchema = z.object({
  key: z.string().trim().min(1),
  value: z.string().optional(),
  masked: z.boolean().optional(),
  isSecret: z.boolean().optional(),
});

const gitSourceSchema = z.object({
  type: z.literal("git"),
  provider: z.enum(["github", "gitlab", "bitbucket", "custom"]),
  repository: z.string().optional(),
  owner: z.string().optional(),
  branch: z.string().optional(),
  buildPath: z.string().optional(),
  projectId: z.string().optional(),
});

const workspaceSourceSchema = z.object({
  type: z.literal("workspace"),
  lastUploadedAt: z.string().optional().nullable(),
  artifactUrl: z.string().optional().nullable(),
  artifactKey: z.string().optional().nullable(),
  expiresAt: z.string().optional().nullable(),
});

const buildSchema = z.object({
  buildType: z.enum([
    "dockerfile",
    "heroku_buildpacks",
    "paketo_buildpacks",
    "nixpacks",
    "static",
  ]),
  dockerfile: z.string().optional().nullable(),
  dockerContextPath: z.string().optional().nullable(),
  dockerBuildStage: z.string().optional().nullable(),
  publishDirectory: z.string().optional().nullable(),
});

const resourcesSchema = z.object({
  cpuLimit: z.number().nullable().optional(),
  cpuReservation: z.number().nullable().optional(),
  memoryLimit: z.number().nullable().optional(),
  memoryReservation: z.number().nullable().optional(),
  replicas: z.number().int().nullable().optional(),
});

const configSchema = z.object({
  baseUrl: z.string().trim().min(1),
  authMethod: z.enum(["x-api-key", "authorization"]),
  projectId: z.string().trim().min(1).optional(),
  serverId: z.string().trim().min(1).optional(),
  applicationId: z.string().trim().min(1).optional(),
  appName: z.string().trim().min(1).optional(),
  domain: z.string().trim().optional(),
  port: z.number().int().min(1).max(65535).optional(),
  traefikConfig: z.string().optional(),
  autoDeploy: z.boolean().optional(),
  env: z.array(envVarSchema).optional(),
  source: z.discriminatedUnion("type", [gitSourceSchema, workspaceSourceSchema]),
  build: buildSchema.optional(),
  resources: resourcesSchema.optional(),
  lastSyncedAt: z.string().optional(),
  apiKey: z.string().optional().nullable(),
});

const loadConfigOrThrow = (): { config: DeployConfig; hasApiKey: boolean } => {
  const stored = database.getDeployConfig();
  if (!stored) {
    throw new Error("Dokploy configuration is not initialized.");
  }
  return { config: stored.config, hasApiKey: stored.hasApiKey };
};

const maskEnvVars = (env?: DeployEnvVar[]): DeployEnvVar[] | undefined => {
  if (!env) {
    return undefined;
  }

  return env.map((entry) => ({
    ...entry,
    value: entry.masked ? undefined : entry.value,
  }));
};

router.get("/deploy/config", (_req: Request, res: Response) => {
  const stored = database.getDeployConfig();
  if (!stored) {
    res.status(404).json({ error: "Dokploy configuration not found." });
    return;
  }

  res.json({
    ...stored.config,
    hasApiKey: stored.hasApiKey,
    env: maskEnvVars(stored.config.env),
  });
});

router.put("/deploy/config", (req: Request, res: Response) => {
  const parsed = configSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    const { formErrors, fieldErrors } = parsed.error.flatten();
    const messages = [...formErrors, ...Object.values(fieldErrors).flat()].filter(
      (message) => message && message.length > 0,
    );
    res.status(400).json({ error: messages.join("; ") || "Invalid payload" });
    return;
  }

  const body = parsed.data;
  const current = database.getDeployConfig();
  const currentEnvMap = new Map<string, DeployEnvVar>();
  if (current?.config.env) {
    current.config.env.forEach((entry) => {
      currentEnvMap.set(entry.key, entry);
    });
  }

  const mergedEnv = body.env?.map((entry) => {
    if (entry.masked && (entry.value === undefined || entry.value === null)) {
      const previous = currentEnvMap.get(entry.key);
      if (previous && previous.value !== undefined) {
        return { ...entry, value: previous.value };
      }
    }
    return entry;
  });

  const configToSave: DeployConfig = {
    baseUrl: body.baseUrl,
    authMethod: body.authMethod,
    projectId: body.projectId,
    serverId: body.serverId,
    applicationId: body.applicationId ?? current?.config.applicationId,
    appName: body.appName,
    domain: body.domain,
    port: body.port,
    traefikConfig: body.traefikConfig,
    autoDeploy: body.autoDeploy,
    env: mergedEnv,
    source: body.source,
    build: body.build,
    resources: body.resources,
    lastSyncedAt: body.lastSyncedAt ?? current?.config.lastSyncedAt,
  };

  const saved = database.saveDeployConfig({
    config: configToSave,
    apiKey: body.apiKey === undefined ? undefined : body.apiKey,
  });

  res.json({
    ...saved.config,
    hasApiKey: saved.hasApiKey,
    env: maskEnvVars(saved.config.env),
  });
});

router.post("/deploy/test", async (req: Request, res: Response) => {
  try {
    // Allow testing with unsaved credentials
    const baseUrlOverride = typeof req.body?.baseUrl === "string" ? req.body.baseUrl : undefined;
    const authMethodOverride = typeof req.body?.authMethod === "string" ? req.body.authMethod : undefined;
    const apiKeyOverride = typeof req.body?.apiKey === "string" ? req.body.apiKey : undefined;

    let config: DeployConfig;
    let apiKey: string;

    if (baseUrlOverride && apiKeyOverride) {
      // Test with provided credentials (before saving)
      config = {
        baseUrl: baseUrlOverride,
        authMethod: (authMethodOverride as DeployAuthMethod) || "x-api-key",
        projectId: "",
        serverId: null,
        applicationId: null,
        appName: null,
        domain: null,
        port: null,
        traefikConfig: null,
        autoDeploy: null,
        env: [],
        source: null,
        build: null,
        resources: null,
        lastSyncedAt: null,
      };
      apiKey = apiKeyOverride;
    } else {
      // Test with saved credentials
      const stored = loadConfigOrThrow();
      config = stored.config;
      apiKey = apiKeyOverride ?? database.getDeployApiKey();
      if (!apiKey) {
        throw new Error("Dokploy API key is not configured.");
      }
    }

    const client = createDokployClient(config, apiKey);
    const result = await client.request({ method: "GET", path: "/project.all" });
    res.json({ ok: true, projects: result });
  } catch (error) {
    console.error("Failed to test Dokploy connection", error);
    res.status(400).json({
      error: error instanceof Error ? error.message : "Unable to connect to Dokploy.",
    });
  }
});

router.post("/deploy/sync", async (_req: Request, res: Response) => {
  try {
    const stored = loadConfigOrThrow();
    const apiKey = database.getDeployApiKey();
    if (!apiKey) {
      throw new Error("Dokploy API key is not configured.");
    }
    const result = await synchronizeDokployApplication(stored.config, apiKey);
    const saved = database.saveDeployConfig({
      config: result.config,
    });

    res.json({
      ...saved.config,
      hasApiKey: saved.hasApiKey,
      env: maskEnvVars(saved.config.env),
    });
  } catch (error) {
    console.error("Failed to synchronize Dokploy application", error);
    res.status(400).json({
      error: error instanceof Error ? error.message : "Synchronization failed.",
    });
  }
});

router.post("/deploy/deploy", async (_req: Request, res: Response) => {
  try {
    const stored = loadConfigOrThrow();
    const apiKey = database.getDeployApiKey();
    if (!apiKey) {
      throw new Error("Dokploy API key is not configured.");
    }
    if (!stored.config.applicationId) {
      throw new Error("Configure applicationId before triggering a deployment.");
    }
    const client = createDokployClient(stored.config, apiKey);
    const result = await client.request({
      method: "POST",
      path: "/application.deploy",
      body: {
        applicationId: stored.config.applicationId,
      },
    });
    res.json({ ok: true, result });
  } catch (error) {
    console.error("Failed to trigger Dokploy deployment", error);
    res.status(400).json({
      error: error instanceof Error ? error.message : "Deployment failed.",
    });
  }
});

router.get("/deploy/projects", async (_req: Request, res: Response) => {
  try {
    const stored = loadConfigOrThrow();
    const apiKey = database.getDeployApiKey();
    if (!apiKey) {
      throw new Error("Dokploy API key is not configured.");
    }
    const client = createDokployClient(stored.config, apiKey);
    const projects = await client.request({ method: "GET", path: "/project.all" });
    res.json({ projects });
  } catch (error) {
    console.error("Failed to fetch Dokploy projects", error);
    res.status(400).json({
      error: error instanceof Error ? error.message : "Unable to fetch projects.",
    });
  }
});

router.get("/deploy/applications", async (req: Request, res: Response) => {
  try {
    const stored = loadConfigOrThrow();
    const apiKey = database.getDeployApiKey();
    if (!apiKey) {
      throw new Error("Dokploy API key is not configured.");
    }
    const client = createDokployClient(stored.config, apiKey);
    const projects = await client.request<any[]>({ method: "GET", path: "/project.all" });
    const projectId = typeof req.query.projectId === "string" ? req.query.projectId : undefined;

    const applications = projects
      .filter((project) => !projectId || project.projectId === projectId)
      .flatMap((project) => project.applications ?? [])
      .map((app: any) => ({
        applicationId: app.applicationId ?? app.id ?? app.appName,
        name: app.name ?? app.appName,
        description: app.description ?? "",
      }));

    res.json({ applications });
  } catch (error) {
    console.error("Failed to fetch Dokploy applications", error);
    res.status(400).json({
      error: error instanceof Error ? error.message : "Unable to fetch applications.",
    });
  }
});

router.post("/deploy/upload", async (req: Request, res: Response) => {
  try {
    const stored = loadConfigOrThrow();
    const workspaceRoot =
      typeof req.body?.workspaceRoot === "string" && req.body.workspaceRoot.trim().length > 0
        ? req.body.workspaceRoot.trim()
        : undefined;

    const archive = await createWorkspaceArchive({ workspaceRoot });
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const origin = `${req.protocol}://${req.get("host")}`;
    const artifactUrl = `${origin}/api/deploy/artifacts/${archive.key}`;

    const updatedConfig: DeployConfig = {
      ...stored.config,
      source: {
        type: "workspace",
        artifactKey: archive.key,
        artifactUrl,
        lastUploadedAt: now.toISOString(),
        expiresAt: expiresAt.toISOString(),
      },
    };

    const saved = database.saveDeployConfig({ config: updatedConfig });

    res.json({
      artifactKey: archive.key,
      artifactUrl,
      size: archive.size,
      expiresAt: expiresAt.toISOString(),
      config: {
        ...saved.config,
        hasApiKey: saved.hasApiKey,
        env: maskEnvVars(saved.config.env),
      },
    });
  } catch (error) {
    console.error("Failed to upload workspace archive", error);
    res.status(400).json({
      error: error instanceof Error ? error.message : "Upload failed.",
    });
  }
});

router.get("/deploy/artifacts/:key", (req: Request, res: Response) => {
  try {
    const filePath = getArtifactPath(req.params.key ?? "");
    if (!fs.existsSync(filePath)) {
      res.status(404).json({ error: "Artifact not found." });
      return;
    }

    res.setHeader("Content-Type", "application/gzip");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${req.params.key ?? "workspace.tar.gz"}"`,
    );
    res.sendFile(filePath);
  } catch (error) {
    res.status(400).json({
      error: error instanceof Error ? error.message : "Invalid artifact key.",
    });
  }
});

export default router;
