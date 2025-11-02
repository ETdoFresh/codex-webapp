import { useCallback, useEffect, useState } from "react";
import {
  fetchDeployConfig,
  updateDeployConfig,
  testDeployConnection,
  fetchDokployEnvironments,
} from "../api/client";
import type { DeployConfigPayload, DeployConfigResult } from "../api/types";

type StatusMessage = {
  type: "success" | "error" | "info";
  text: string;
};

const DokployPanel = () => {
  const [initialConfig, setInitialConfig] = useState<DeployConfigResult | null>(null);
  const [baseUrl, setBaseUrl] = useState<string>("");
  const [authMethod, setAuthMethod] = useState<"x-api-key" | "authorization">("x-api-key");
  const [apiKeyInput, setApiKeyInput] = useState<string>("");
  const [projectId, setProjectId] = useState<string>("");
  const [environmentId, setEnvironmentId] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [status, setStatus] = useState<StatusMessage | null>(null);
  const [projects, setProjects] = useState<Array<{ projectId: string; name: string }>>([]);
  const [environments, setEnvironments] = useState<Array<{ environmentId: string; name: string }>>([]);
  const [loadingEnvironments, setLoadingEnvironments] = useState(false);

  const loadConfig = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchDeployConfig();
      setInitialConfig(data);
      setBaseUrl(data.baseUrl || "");
      setAuthMethod(data.authMethod || "x-api-key");
      setProjectId(data.projectId || "");
      setEnvironmentId(data.environmentId || "");
      setApiKeyInput("");
      setStatus(null);
    } catch (error) {
      console.error("Failed to load deploy config", error);
      setStatus({ type: "error", text: "Failed to load Dokploy configuration." });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadConfig();
  }, [loadConfig]);

  useEffect(() => {
    const fetchEnvironments = async () => {
      if (!projectId) {
        setEnvironments([]);
        return;
      }

      console.log('[DokployPanel] Fetching environments for projectId:', projectId);
      setLoadingEnvironments(true);
      try {
        const result = await fetchDokployEnvironments(projectId);
        console.log('[DokployPanel] Fetched environments:', result.environments);
        setEnvironments(result.environments);
      } catch (error) {
        console.error("[DokployPanel] Failed to fetch environments", error);
        setEnvironments([]);
      } finally {
        setLoadingEnvironments(false);
      }
    };

    void fetchEnvironments();
  }, [projectId]);

  const handleTestConnection = async () => {
    setTesting(true);
    setStatus(null);

    try {
      const result = await testDeployConnection({
        baseUrl,
        authMethod,
        apiKey: apiKeyInput || undefined,
      });

      if (result.ok && result.projects) {
        const projectList = Array.isArray(result.projects)
          ? result.projects.map((p: any) => ({
              projectId: p.projectId || p.id || "",
              name: p.name || p.projectId || p.id || "Unnamed Project",
            }))
          : [];

        setProjects(projectList);
        setStatus({
          type: "success",
          text: `Connection successful! Found ${projectList.length} project(s).`,
        });
      } else {
        setStatus({
          type: "error",
          text: result.error || "Connection test failed.",
        });
      }
    } catch (error: any) {
      setStatus({
        type: "error",
        text: error?.message || "Failed to test connection.",
      });
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setStatus(null);

    try {
      const payload: DeployConfigPayload = {
        ...initialConfig!,
        baseUrl,
        authMethod,
        projectId,
        environmentId,
        apiKey: apiKeyInput || undefined,
      };

      await updateDeployConfig(payload);
      setStatus({ type: "success", text: "Settings saved successfully!" });
      setApiKeyInput("");
      await loadConfig();
    } catch (error: any) {
      setStatus({
        type: "error",
        text: error?.message || "Failed to save settings.",
      });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="deploy-panel">Loading Dokploy configuration…</div>;
  }

  return (
    <div className="deploy-panel">
      <h1 style={{ marginTop: 0 }}>Dokploy Configuration</h1>
      <p className="muted" style={{ marginBottom: "2em" }}>
        Configure global Dokploy server settings. These settings apply to all service-based sessions.
      </p>

      {status && (
        <div className={`deploy-status deploy-status-${status.type}`}>
          {status.text}
        </div>
      )}

      <section className="deploy-section">
        <h2>Connection Settings</h2>
        <div className="deploy-grid">
          <label>
            <span>Base URL</span>
            <input
              type="text"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="https://dokploy.example.com/api"
            />
          </label>

          <label>
            <span>Auth Method</span>
            <select
              value={authMethod}
              onChange={(e) =>
                setAuthMethod(e.target.value as "x-api-key" | "authorization")
              }
            >
              <option value="x-api-key">X-API-Key Header</option>
              <option value="authorization">Bearer Token (Authorization)</option>
            </select>
          </label>

          <label>
            <span>
              API Key {initialConfig?.hasApiKey ? "(stored securely)" : ""}
            </span>
            <input
              type="password"
              value={apiKeyInput}
              onChange={(e) => setApiKeyInput(e.target.value)}
              placeholder={
                initialConfig?.hasApiKey ? "••••••••" : "Enter your Dokploy API key"
              }
            />
          </label>

          <label>
            <span>Project ID</span>
            {projects.length > 0 ? (
              <select
                value={projectId}
                onChange={(e) => setProjectId(e.target.value)}
              >
                <option value="">Select a project...</option>
                {projects.map((project) => (
                  <option key={project.projectId} value={project.projectId}>
                    {project.name} ({project.projectId})
                  </option>
                ))}
              </select>
            ) : (
              <input
                type="text"
                value={projectId}
                onChange={(e) => setProjectId(e.target.value)}
                placeholder="Test connection to load projects"
              />
            )}
            <small className="muted">
              {projects.length > 0
                ? "Select a project from the list"
                : "Test connection first to load available projects"}
            </small>
          </label>

          <label>
            <span>Environment ID</span>
            {environments.length > 0 ? (
              <select
                value={environmentId}
                onChange={(e) => setEnvironmentId(e.target.value)}
                disabled={loadingEnvironments}
              >
                <option value="">Select an environment...</option>
                {environments.map((env) => (
                  <option key={env.environmentId} value={env.environmentId}>
                    {env.name} ({env.environmentId})
                  </option>
                ))}
              </select>
            ) : (
              <input
                type="text"
                value={environmentId}
                onChange={(e) => setEnvironmentId(e.target.value)}
                placeholder={
                  loadingEnvironments
                    ? "Loading environments..."
                    : projectId
                    ? "Select a project first to load environments"
                    : "Test connection to load projects and environments"
                }
                disabled={loadingEnvironments}
              />
            )}
            <small className="muted">
              {environments.length > 0
                ? "Select an environment from the list"
                : "Required for creating new services"}
            </small>
          </label>
        </div>

        <div className="deploy-actions">
          <button
            type="button"
            onClick={handleTestConnection}
            disabled={testing || !baseUrl}
          >
            {testing ? "Testing…" : "Test Connection"}
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || !baseUrl || !projectId || !environmentId}
          >
            {saving ? "Saving…" : "Save Settings"}
          </button>
        </div>
      </section>
    </div>
  );
};

export default DokployPanel;
