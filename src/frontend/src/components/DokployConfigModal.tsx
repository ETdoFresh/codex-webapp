import { useCallback, useEffect, useState } from "react";
import {
  fetchDeployConfig,
  updateDeployConfig,
  testDeployConnection,
} from "../api/client";
import type { DeployConfigPayload, DeployConfigResult } from "../api/types";

type StatusMessage = {
  type: "success" | "error" | "info";
  text: string;
};

type DokployConfigModalProps = {
  isOpen: boolean;
  onClose: () => void;
};

export const DokployConfigModal = ({ isOpen, onClose }: DokployConfigModalProps) => {
  const [initialConfig, setInitialConfig] = useState<DeployConfigResult | null>(null);
  const [baseUrl, setBaseUrl] = useState<string>("");
  const [authMethod, setAuthMethod] = useState<"x-api-key" | "authorization">("x-api-key");
  const [apiKeyInput, setApiKeyInput] = useState<string>("");
  const [projectId, setProjectId] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [status, setStatus] = useState<StatusMessage | null>(null);

  const loadConfig = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchDeployConfig();
      setInitialConfig(data);
      setBaseUrl(data.baseUrl || "");
      setAuthMethod(data.authMethod || "x-api-key");
      setProjectId(data.projectId || "");
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
    if (isOpen) {
      void loadConfig();
    }
  }, [isOpen, loadConfig]);

  const handleTestConnection = async () => {
    setTesting(true);
    setStatus(null);

    try {
      const payload: DeployConfigPayload = {
        ...initialConfig!,
        baseUrl,
        authMethod,
        apiKey: apiKeyInput || undefined,
      };

      const result = await testDeployConnection(payload);
      if (result.success) {
        setStatus({ type: "success", text: "Connection test succeeded!" });
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

  if (!isOpen) {
    return null;
  }

  return (
    <div
      className="modal-backdrop"
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        backgroundColor: "rgba(0, 0, 0, 0.5)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
      }}
    >
      <div
        className="modal-content"
        onClick={(e) => e.stopPropagation()}
        style={{
          backgroundColor: "#1e293b",
          border: "1px solid rgba(71, 85, 105, 0.3)",
          borderRadius: "8px",
          padding: "2em",
          maxWidth: "600px",
          width: "90%",
          maxHeight: "80vh",
          overflow: "auto",
          boxShadow: "0 30px 70px rgba(0, 0, 0, 0.6)",
        }}
      >
        <h2>Dokploy Configuration</h2>
        <p className="modal-description">
          Configure global Dokploy server settings. These settings apply to all container-based sessions.
        </p>

        {status && (
          <div className={`deploy-status deploy-status-${status.type}`}>
            {status.text}
          </div>
        )}

        {loading ? (
          <div style={{ padding: "2em", textAlign: "center" }}>Loading configuration…</div>
        ) : (
          <div>
            <h3 style={{ marginTop: "1.5em", marginBottom: "1em" }}>Connection Settings</h3>

            <label style={{ display: "block", marginBottom: "1em" }}>
              <span style={{ display: "block", marginBottom: "0.5em" }}>Base URL</span>
              <input
                type="text"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                placeholder="https://dokploy.example.com/api"
                style={{ width: "100%" }}
              />
            </label>

            <label style={{ display: "block", marginBottom: "1em" }}>
              <span style={{ display: "block", marginBottom: "0.5em" }}>Auth Method</span>
              <select
                value={authMethod}
                onChange={(e) =>
                  setAuthMethod(e.target.value as "x-api-key" | "authorization")
                }
                style={{ width: "100%" }}
              >
                <option value="x-api-key">X-API-Key Header</option>
                <option value="authorization">Bearer Token (Authorization)</option>
              </select>
            </label>

            <label style={{ display: "block", marginBottom: "1em" }}>
              <span style={{ display: "block", marginBottom: "0.5em" }}>
                API Key {initialConfig?.hasApiKey ? "(stored securely)" : ""}
              </span>
              <input
                type="password"
                value={apiKeyInput}
                onChange={(e) => setApiKeyInput(e.target.value)}
                placeholder={
                  initialConfig?.hasApiKey ? "••••••••" : "Enter your Dokploy API key"
                }
                style={{ width: "100%" }}
              />
            </label>

            <label style={{ display: "block", marginBottom: "1em" }}>
              <span style={{ display: "block", marginBottom: "0.5em" }}>Project ID</span>
              <input
                type="text"
                value={projectId}
                onChange={(e) => setProjectId(e.target.value)}
                placeholder="Your Dokploy project ID"
                style={{ width: "100%" }}
              />
              <small className="muted">Required for creating new containers</small>
            </label>

            <div style={{ display: "flex", gap: "1em", marginTop: "2em" }}>
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
                disabled={saving || !baseUrl || !projectId}
              >
                {saving ? "Saving…" : "Save Settings"}
              </button>
              <button type="button" onClick={onClose}>
                Close
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
