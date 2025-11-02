import { useCallback, useEffect, useState } from "react";
import {
  getGitHubConnectionStatus,
  initiateGitHubAuth,
  disconnectGitHub,
} from "../api/client";

type StatusMessage = {
  type: "success" | "error" | "info";
  text: string;
};

const GitHubConnectionPanel = () => {
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [status, setStatus] = useState<StatusMessage | null>(null);

  const checkConnection = useCallback(async () => {
    setLoading(true);
    setStatus(null);
    try {
      const result = await getGitHubConnectionStatus();
      setConnected(result.connected);
    } catch (error) {
      console.error("Failed to check GitHub connection", error);
      setStatus({ type: "error", text: "Failed to check GitHub connection status." });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void checkConnection();
  }, [checkConnection]);

  // Check URL for OAuth success callback
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("github_connected") === "true") {
      setStatus({ type: "success", text: "GitHub connected successfully!" });
      setConnected(true);
      // Clean up URL
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);

  const handleConnect = async () => {
    setConnecting(true);
    setStatus(null);
    try {
      const { url } = await initiateGitHubAuth();
      // Redirect to GitHub OAuth page
      window.location.href = url;
    } catch (error: any) {
      console.error("Failed to initiate GitHub OAuth", error);
      setStatus({
        type: "error",
        text: error?.message || "Failed to initiate GitHub connection.",
      });
      setConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    if (!confirm("Are you sure you want to disconnect GitHub? This will remove your stored GitHub token.")) {
      return;
    }

    setDisconnecting(true);
    setStatus(null);
    try {
      await disconnectGitHub();
      setConnected(false);
      setStatus({ type: "success", text: "GitHub disconnected successfully." });
    } catch (error: any) {
      console.error("Failed to disconnect GitHub", error);
      setStatus({
        type: "error",
        text: error?.message || "Failed to disconnect GitHub.",
      });
    } finally {
      setDisconnecting(false);
    }
  };

  if (loading) {
    return (
      <div className="deploy-panel">
        <h1 style={{ marginTop: 0 }}>GitHub Connection</h1>
        <p className="muted">Loading GitHub connection status...</p>
      </div>
    );
  }

  return (
    <div className="deploy-panel">
      <h1 style={{ marginTop: 0 }}>GitHub Connection</h1>
      <p className="muted" style={{ marginBottom: "2em" }}>
        Connect your GitHub account to enable automatic branch creation and Git
        synchronization for your sessions.
      </p>

      {status && (
        <div className={`deploy-status deploy-status-${status.type}`}>
          {status.text}
        </div>
      )}

      <section className="deploy-section">
        <h2>Connection Status</h2>
        <div className="deploy-grid">
          <div style={{ marginBottom: "1em" }}>
            <strong>Status:</strong>{" "}
            <span
              style={{
                color: connected ? "var(--success-color, #4ade80)" : "var(--muted-color, #666)",
                fontWeight: "bold",
              }}
            >
              {connected ? "✓ Connected" : "Not Connected"}
            </span>
          </div>

          {connected ? (
            <>
              <p className="muted" style={{ marginBottom: "1em" }}>
                Your GitHub account is connected. You can now create sessions
                with automatic branch management.
              </p>
              <button
                onClick={handleDisconnect}
                disabled={disconnecting}
                className="button-secondary"
              >
                {disconnecting ? "Disconnecting..." : "Disconnect GitHub"}
              </button>
            </>
          ) : (
            <>
              <p className="muted" style={{ marginBottom: "1em" }}>
                Connect your GitHub account to enable:
              </p>
              <ul className="muted" style={{ marginBottom: "1em", paddingLeft: "1.5em" }}>
                <li>Automatic branch creation for sessions</li>
                <li>Git synchronization from workspace to branch</li>
                <li>1:1 session-to-branch mapping</li>
              </ul>
              <button
                onClick={handleConnect}
                disabled={connecting}
                className="button-primary"
              >
                {connecting ? "Connecting..." : "Connect GitHub"}
              </button>
            </>
          )}
        </div>
      </section>

      {connected && (
        <section className="deploy-section">
          <h2>Permissions</h2>
          <p className="muted">
            The following GitHub permissions are granted:
          </p>
          <ul className="muted" style={{ paddingLeft: "1.5em" }}>
            <li><strong>repo</strong> - Access to repositories (required for branch operations)</li>
            <li><strong>user:email</strong> - Access to your email address</li>
          </ul>
        </section>
      )}
    </div>
  );
};

export default GitHubConnectionPanel;
