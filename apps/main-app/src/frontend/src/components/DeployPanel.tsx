import { useCallback, useEffect, useMemo, useState } from "react";
import {
  fetchDeployConfig,
  updateDeployConfig,
  testDeployConnection,
  syncDeployConfig,
  triggerDeployment,
  fetchDokployProjects,
  fetchDokployApplications,
  uploadWorkspaceArtifact,
} from "../api/client";
import type {
  DeployConfigPayload,
  DeployConfigResult,
} from "../api/types";
import type {
  DeployBuildConfig,
  DeployEnvVar,
  DeploySource,
  DeploySourceGit,
} from "../../../shared/dokploy";

type StatusMessage = {
  type: "success" | "error" | "info";
  text: string;
};

const defaultGitSource: DeploySourceGit = {
  type: "git",
  provider: "github",
  repository: "",
  owner: "",
  branch: "",
  buildPath: "",
};

const cloneEnv = (env?: DeployEnvVar[]): DeployEnvVar[] =>
  env ? env.map((entry) => ({ ...entry })) : [];

const ensureSource = (source?: DeploySource): DeploySource => {
  if (!source) {
    return { ...defaultGitSource };
  }
  if (source.type === "git") {
    return { ...source };
  }
  return { ...source };
};

const normalizeBuildConfig = (
  build: DeployConfigPayload["build"],
): DeployBuildConfig => {
  if (!build) {
    return {
      buildType: "dockerfile",
      dockerContextPath: ".",
    };
  }
  return { ...build };
};

const formatBytes = (value: number): string => {
  if (value < 1024) {
    return `${value} B`;
  }
  if (value < 1024 * 1024) {
    return `${(value / 1024).toFixed(1)} KB`;
  }
  return `${(value / (1024 * 1024)).toFixed(2)} MB`;
};

const DeployPanel = () => {
  const [initialConfig, setInitialConfig] = useState<DeployConfigResult | null>(null);
  const [draft, setDraft] = useState<DeployConfigPayload | null>(null);
  const [apiKeyInput, setApiKeyInput] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [deploying, setDeploying] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [status, setStatus] = useState<StatusMessage | null>(null);
  const [projects, setProjects] = useState<unknown[]>([]);
  const [applications, setApplications] = useState<
    Array<{ applicationId: string; name: string; description: string }>
  >([]);

  const applyDraft = useCallback((config: DeployConfigResult) => {
    const { hasApiKey: _hasApiKey, ...rest } = config;
    setDraft({
      ...rest,
      env: cloneEnv(rest.env),
      source: ensureSource(rest.source),
      build: normalizeBuildConfig(rest.build),
    });
    setApiKeyInput("");
  }, []);

  const loadConfig = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchDeployConfig();
      setInitialConfig(data);
      applyDraft(data);
      setStatus(null);
    } catch (error) {
      console.error("Failed to load deploy config", error);
      setStatus({ type: "error", text: "Failed to load Dokploy configuration." });
    } finally {
      setLoading(false);
    }
  }, [applyDraft]);

  useEffect(() => {
    void loadConfig();
  }, [loadConfig]);

  const updateDraft = useCallback(
    <K extends keyof DeployConfigPayload>(key: K, value: DeployConfigPayload[K]) => {
      setDraft((previous) => {
        if (!previous) {
          return previous;
        }
        return {
          ...previous,
          [key]: value,
        };
      });
    },
    [],
  );

  const updateSource = useCallback(
    (value: DeploySource) => {
      setDraft((previous) => {
        if (!previous) {
          return previous;
        }
        return {
          ...previous,
          source: value,
        };
      });
    },
    [],
  );

  const updateEnvEntry = useCallback(
    (index: number, patch: Partial<DeployEnvVar>) => {
      setDraft((previous) => {
        if (!previous) {
          return previous;
        }
        const env = cloneEnv(previous.env);
        if (!env[index]) {
          return previous;
        }
        env[index] = { ...env[index], ...patch };
        return { ...previous, env };
      });
    },
    [],
  );

  const addEnvEntry = useCallback(() => {
    setDraft((previous) => {
      if (!previous) {
        return previous;
      }
      const env = cloneEnv(previous.env);
      env.push({ key: "", value: "" });
      return { ...previous, env };
    });
  }, []);

  const removeEnvEntry = useCallback((index: number) => {
    setDraft((previous) => {
      if (!previous) {
        return previous;
      }
      const env = cloneEnv(previous.env);
      env.splice(index, 1);
      return { ...previous, env };
    });
  }, []);

  const handleSave = useCallback(async () => {
    if (!draft) {
      return;
    }
    setSaving(true);
    setStatus(null);
    try {
      const payload: DeployConfigPayload = {
        ...draft,
        env: cloneEnv(draft.env),
        source: ensureSource(draft.source),
        build: normalizeBuildConfig(draft.build),
      };

      if (apiKeyInput.trim().length > 0) {
        payload.apiKey = apiKeyInput.trim();
      }

      const updated = await updateDeployConfig(payload);
      setInitialConfig(updated);
      applyDraft(updated);
      setStatus({ type: "success", text: "Dokploy configuration saved." });
    } catch (error) {
      console.error("Failed to save Dokploy config", error);
      const message =
        error instanceof Error ? error.message : "Unable to save Dokploy configuration.";
      setStatus({ type: "error", text: message });
    } finally {
      setSaving(false);
    }
  }, [apiKeyInput, applyDraft, draft]);

  const handleTestConnection = useCallback(async () => {
    setTesting(true);
    setStatus(null);
    try {
      const result = await testDeployConnection(apiKeyInput.trim() || undefined);
      if (result.ok) {
        setStatus({ type: "success", text: "Successfully connected to Dokploy." });
      } else {
        setStatus({ type: "error", text: result.error ?? "Connection failed." });
      }
    } catch (error) {
      console.error("Failed to test Dokploy connection", error);
      setStatus({
        type: "error",
        text: error instanceof Error ? error.message : "Connection test failed.",
      });
    } finally {
      setTesting(false);
    }
  }, [apiKeyInput]);

  const handleSync = useCallback(async () => {
    setSyncing(true);
    setStatus(null);
    try {
      const updated = await syncDeployConfig();
      setInitialConfig(updated);
      applyDraft(updated);
      setStatus({ type: "success", text: "Synchronized Dokploy application." });
    } catch (error) {
      console.error("Failed to synchronize Dokploy application", error);
      setStatus({
        type: "error",
        text: error instanceof Error ? error.message : "Synchronization failed.",
      });
    } finally {
      setSyncing(false);
    }
  }, [applyDraft]);

  const handleDeploy = useCallback(async () => {
    setDeploying(true);
    setStatus(null);
    try {
      await triggerDeployment();
      setStatus({ type: "success", text: "Deployment triggered successfully." });
    } catch (error) {
      console.error("Failed to trigger Dokploy deployment", error);
      setStatus({
        type: "error",
        text: error instanceof Error ? error.message : "Deployment failed.",
      });
    } finally {
      setDeploying(false);
    }
  }, []);

  const handleRefreshProjects = useCallback(async () => {
    try {
      const result = await fetchDokployProjects();
      setProjects(result.projects);
      setStatus({ type: "info", text: "Fetched projects from Dokploy." });
    } catch (error) {
      console.error("Failed to fetch Dokploy projects", error);
      setStatus({
        type: "error",
        text: error instanceof Error ? error.message : "Unable to fetch projects.",
      });
    }
  }, []);

  const handleRefreshApplications = useCallback(async () => {
    const projectId = draft?.projectId;
    if (!projectId) {
      setStatus({ type: "error", text: "Set a project ID before loading applications." });
      return;
    }
    try {
      const result = await fetchDokployApplications(projectId);
      setApplications(result.applications);
      setStatus({ type: "info", text: "Fetched applications from Dokploy." });
    } catch (error) {
      console.error("Failed to fetch Dokploy applications", error);
      setStatus({
        type: "error",
        text: error instanceof Error ? error.message : "Unable to fetch applications.",
      });
    }
  }, [draft?.projectId]);

  const handleUploadWorkspace = useCallback(async () => {
    setUploading(true);
    setStatus(null);
    try {
      const result = await uploadWorkspaceArtifact();
      setInitialConfig(result.config);
      applyDraft(result.config);
      setStatus({
        type: "success",
        text: `Workspace uploaded (${formatBytes(result.size)}).`,
      });
    } catch (error) {
      console.error("Failed to upload workspace", error);
      setStatus({
        type: "error",
        text: error instanceof Error ? error.message : "Workspace upload failed.",
      });
    } finally {
      setUploading(false);
    }
  }, [applyDraft]);

  const workspaceInfo = useMemo(() => {
    if (!draft || draft.source.type !== "workspace") {
      return null;
    }
    return draft.source;
  }, [draft]);

  const gitSource = draft?.source.type === "git" ? draft.source : defaultGitSource;

  if (loading || !draft) {
    return <div className="deploy-panel">Loading Dokploy settings…</div>;
    }

  return (
    <div className="deploy-panel">
      {status ? (
        <div className={`deploy-status deploy-status-${status.type}`}>{status.text}</div>
      ) : null}

      <section className="deploy-section">
        <h2>Dokploy Connection</h2>
        <div className="deploy-grid">
          <label>
            <span>Base URL</span>
            <input
              type="text"
              value={draft.baseUrl}
              onChange={(event) => updateDraft("baseUrl", event.target.value)}
              placeholder="https://dokploy.example.com/api"
            />
          </label>
          <label>
            <span>Auth Method</span>
            <select
              value={draft.authMethod}
              onChange={(event) =>
                updateDraft("authMethod", event.target.value as DeployConfigPayload["authMethod"])
              }
            >
              <option value="x-api-key">X-API-Key Header</option>
              <option value="authorization">Bearer Token (Authorization)</option>
            </select>
          </label>
          <label>
            <span>API Key {initialConfig?.hasApiKey ? "(stored)" : ""}</span>
            <input
              type="password"
              value={apiKeyInput}
              onChange={(event) => setApiKeyInput(event.target.value)}
              placeholder={initialConfig?.hasApiKey ? "••••••••" : "dokploy-token"}
            />
          </label>
        </div>
        <div className="deploy-actions">
          <button type="button" onClick={handleTestConnection} disabled={testing}>
            {testing ? "Testing…" : "Test Connection"}
          </button>
          <button type="button" onClick={handleSave} disabled={saving}>
            {saving ? "Saving…" : "Save Settings"}
          </button>
        </div>
      </section>

      <section className="deploy-section">
        <h2>Application Details</h2>
        <div className="deploy-grid">
          <label>
            <span>Project ID</span>
            <input
              type="text"
              value={draft.projectId ?? ""}
              onChange={(event) => updateDraft("projectId", event.target.value)}
              placeholder="dokploy project ID"
            />
          </label>
          <label>
            <span>Application ID</span>
            <input
              type="text"
              value={draft.applicationId ?? ""}
              onChange={(event) => updateDraft("applicationId", event.target.value)}
              placeholder="dokploy application ID"
            />
          </label>
          <label>
            <span>Server ID (optional)</span>
            <input
              type="text"
              value={draft.serverId ?? ""}
              onChange={(event) => updateDraft("serverId", event.target.value)}
            />
          </label>
          <label>
            <span>Application Name</span>
            <input
              type="text"
              value={draft.appName ?? ""}
              onChange={(event) => updateDraft("appName", event.target.value)}
              placeholder="my-webapp"
            />
          </label>
          <label>
            <span>Domain</span>
            <input
              type="text"
              value={draft.domain ?? ""}
              onChange={(event) => updateDraft("domain", event.target.value)}
              placeholder="webapp.example.com"
            />
          </label>
          <label>
            <span>Internal Port</span>
            <input
              type="number"
              value={draft.port ?? ""}
              onChange={(event) =>
                updateDraft("port", event.target.value ? Number(event.target.value) : undefined)
              }
              min={1}
              max={65535}
            />
          </label>
          <label className="deploy-toggle">
            <input
              type="checkbox"
              checked={Boolean(draft.autoDeploy)}
              onChange={(event) => updateDraft("autoDeploy", event.target.checked)}
            />
            <span>Enable Auto Deploy</span>
          </label>
        </div>
        <div className="deploy-actions">
          <button type="button" onClick={handleRefreshProjects}>
            Load Projects
          </button>
          <button type="button" onClick={handleRefreshApplications}>
            Load Applications
          </button>
          <button type="button" onClick={handleSync} disabled={syncing}>
            {syncing ? "Syncing…" : "Sync with Dokploy"}
          </button>
          <button type="button" onClick={handleDeploy} disabled={deploying}>
            {deploying ? "Deploying…" : "Deploy Now"}
          </button>
        </div>
        {projects.length > 0 ? (
          <div className="deploy-data-preview">
            <strong>Projects Loaded:</strong>
            <pre>{JSON.stringify(projects, null, 2)}</pre>
          </div>
        ) : null}
        {applications.length > 0 ? (
          <div className="deploy-data-preview">
            <strong>Applications Loaded:</strong>
            <pre>{JSON.stringify(applications, null, 2)}</pre>
          </div>
        ) : null}
      </section>

      <section className="deploy-section">
        <h2>Source</h2>
        <div className="deploy-source-toggle">
          <label>
            <input
              type="radio"
              name="deploy-source"
              checked={draft.source.type === "git"}
              onChange={() => updateSource({ ...defaultGitSource })}
            />
            Git Repository
          </label>
          <label>
            <input
              type="radio"
              name="deploy-source"
              checked={draft.source.type === "workspace"}
              onChange={() =>
                updateSource({
                  type: "workspace",
                  artifactKey: workspaceInfo?.artifactKey ?? null,
                  artifactUrl: workspaceInfo?.artifactUrl ?? null,
                  lastUploadedAt: workspaceInfo?.lastUploadedAt ?? null,
                  expiresAt: workspaceInfo?.expiresAt ?? null,
                })
              }
            />
            Upload Workspace Snapshot
          </label>
        </div>

        {draft.source.type === "git" ? (
          <div className="deploy-grid">
            <label>
              <span>Provider</span>
              <select
                value={gitSource.provider}
                onChange={(event) =>
                  updateSource({
                    ...gitSource,
                    provider: event.target.value as DeploySourceGit["provider"],
                  })
                }
              >
                <option value="github">GitHub</option>
                <option value="gitlab">GitLab</option>
                <option value="bitbucket">Bitbucket</option>
                <option value="custom">Custom Git</option>
              </select>
            </label>
            <label>
              <span>Repository</span>
              <input
                type="text"
                value={gitSource.repository ?? ""}
                onChange={(event) =>
                  updateSource({ ...gitSource, repository: event.target.value })
                }
                placeholder="owner/repository or git URL"
              />
            </label>
            <label>
              <span>Owner / Namespace</span>
              <input
                type="text"
                value={gitSource.owner ?? ""}
                onChange={(event) => updateSource({ ...gitSource, owner: event.target.value })}
              />
            </label>
            <label>
              <span>Branch</span>
              <input
                type="text"
                value={gitSource.branch ?? ""}
                onChange={(event) => updateSource({ ...gitSource, branch: event.target.value })}
                placeholder="main"
              />
            </label>
            <label>
              <span>Build Path</span>
              <input
                type="text"
                value={gitSource.buildPath ?? ""}
                onChange={(event) =>
                  updateSource({ ...gitSource, buildPath: event.target.value })
                }
                placeholder="/"
              />
            </label>
          </div>
        ) : (
          <div className="deploy-workspace-info">
            <p>
              Upload the current workspace as a tar.gz artifact. Dokploy will pull the archive using
              a generated URL when deploying.
            </p>
            {workspaceInfo?.artifactUrl ? (
              <p>
                <strong>Last Upload:</strong> {workspaceInfo.lastUploadedAt ?? "Unknown"} —
                <a href={workspaceInfo.artifactUrl} target="_blank" rel="noreferrer">
                  Download
                </a>
              </p>
            ) : (
              <p>No workspace artifact uploaded yet.</p>
            )}
            <button type="button" onClick={handleUploadWorkspace} disabled={uploading}>
              {uploading ? "Uploading…" : "Upload Current Workspace"}
            </button>
          </div>
        )}
      </section>

      <section className="deploy-section">
        <h2>Build Settings</h2>
        <div className="deploy-grid">
          <label>
            <span>Build Type</span>
            <select
              value={draft.build?.buildType ?? "dockerfile"}
              onChange={(event) =>
                updateDraft("build", {
                  ...normalizeBuildConfig(draft.build),
                  buildType: event.target.value as NonNullable<typeof draft.build>["buildType"],
                })
              }
            >
              <option value="dockerfile">Dockerfile</option>
              <option value="heroku_buildpacks">Heroku Buildpacks</option>
              <option value="paketo_buildpacks">Paketo Buildpacks</option>
              <option value="nixpacks">Nixpacks</option>
              <option value="static">Static Assets</option>
            </select>
          </label>
          <label>
            <span>Dockerfile Path</span>
            <input
              type="text"
              value={draft.build?.dockerfile ?? ""}
              onChange={(event) =>
                updateDraft("build", {
                  ...normalizeBuildConfig(draft.build),
                  dockerfile: event.target.value,
                })
              }
              placeholder="Dockerfile"
            />
          </label>
          <label>
            <span>Context Path</span>
            <input
              type="text"
              value={draft.build?.dockerContextPath ?? ""}
              onChange={(event) =>
                updateDraft("build", {
                  ...normalizeBuildConfig(draft.build),
                  dockerContextPath: event.target.value,
                })
              }
              placeholder="."
            />
          </label>
          <label>
            <span>Build Stage</span>
            <input
              type="text"
              value={draft.build?.dockerBuildStage ?? ""}
              onChange={(event) =>
                updateDraft("build", {
                  ...normalizeBuildConfig(draft.build),
                  dockerBuildStage: event.target.value,
                })
              }
            />
          </label>
          <label>
            <span>Publish Directory</span>
            <input
              type="text"
              value={draft.build?.publishDirectory ?? ""}
              onChange={(event) =>
                updateDraft("build", {
                  ...normalizeBuildConfig(draft.build),
                  publishDirectory: event.target.value,
                })
              }
              placeholder="dist"
            />
          </label>
        </div>
      </section>

      <section className="deploy-section">
        <h2>Environment Variables</h2>
        {draft.env && draft.env.length > 0 ? (
          <table className="deploy-env-table">
            <thead>
              <tr>
                <th>Key</th>
                <th>Value</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {draft.env.map((envVar, index) => (
                <tr key={`${envVar.key}-${index}`}>
                  <td>
                    <input
                      type="text"
                      value={envVar.key}
                      onChange={(event) => updateEnvEntry(index, { key: event.target.value })}
                    />
                  </td>
                  <td>
                    <input
                      type="text"
                      value={envVar.value ?? ""}
                      onChange={(event) => updateEnvEntry(index, { value: event.target.value })}
                      placeholder={envVar.masked ? "••••••" : ""}
                    />
                  </td>
                  <td>
                    <button type="button" onClick={() => removeEnvEntry(index)}>
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p>No environment variables configured.</p>
        )}
        <button type="button" onClick={addEnvEntry}>
          Add Variable
        </button>
      </section>

      <section className="deploy-section">
        <h2>Traefik Configuration</h2>
        <textarea
          value={draft.traefikConfig ?? ""}
          onChange={(event) => updateDraft("traefikConfig", event.target.value)}
          rows={8}
          placeholder="Optional raw Traefik JSON configuration"
        />
      </section>
    </div>
  );
};

export default DeployPanel;
