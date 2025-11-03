import { useState, useEffect, useRef } from "react";

type DeploymentLogsProps = {
  sessionId: string;
  onComplete?: () => void;
};

type LogsResponse = {
  logs: string;
  status: string;
  deploymentId?: string;
};

const DeploymentLogs = ({ sessionId, onComplete }: DeploymentLogsProps) => {
  const [logs, setLogs] = useState<string>("Fetching deployment logs...");
  const [status, setStatus] = useState<string>("loading");
  const [error, setError] = useState<string | null>(null);
  const logsEndRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when logs update
  useEffect(() => {
    if (logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [logs]);

  // Poll deployment logs
  useEffect(() => {
    let cancelled = false;
    let pollTimer: NodeJS.Timeout | null = null;

    const fetchLogs = async () => {
      try {
        const response = await fetch(
          `/api/sessions/${sessionId}/service/deployment-logs`
        );

        if (!response.ok) {
          throw new Error(`Failed to fetch logs: ${response.statusText}`);
        }

        const data: LogsResponse = await response.json();

        if (!cancelled) {
          setLogs(data.logs);
          setStatus(data.status);
          setError(null);

          // If deployment is complete (success or error), stop polling
          if (data.status === "done" || data.status === "error") {
            if (onComplete) {
              onComplete();
            }
          } else {
            // Continue polling if still in progress
            pollTimer = setTimeout(fetchLogs, 3000);
          }
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to fetch logs");
          // Retry on error
          pollTimer = setTimeout(fetchLogs, 5000);
        }
      }
    };

    fetchLogs();

    return () => {
      cancelled = true;
      if (pollTimer) {
        clearTimeout(pollTimer);
      }
    };
  }, [sessionId, onComplete]);

  const getStatusColor = (status: string): string => {
    switch (status) {
      case "done":
        return "var(--color-success-text)";
      case "error":
        return "var(--color-error-text)";
      case "running":
        return "var(--color-warning-text)";
      default:
        return "inherit";
    }
  };

  const getStatusEmoji = (status: string): string => {
    switch (status) {
      case "done":
        return "✅";
      case "error":
        return "❌";
      case "running":
        return "⏳";
      default:
        return "🔄";
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <div style={{ padding: "1rem", borderBottom: "1px solid var(--color-border)" }}>
        <h4 style={{ margin: "0 0 0.5rem 0" }}>Deployment Build Logs</h4>
        <div style={{ fontSize: "0.9rem", color: getStatusColor(status) }}>
          <strong>Status:</strong> {getStatusEmoji(status)} {status}
        </div>
        {error && (
          <div style={{ fontSize: "0.85rem", color: "var(--color-error-text)", marginTop: "0.5rem" }}>
            {error}
          </div>
        )}
      </div>

      <div
        ref={containerRef}
        style={{
          flex: 1,
          overflow: "auto",
          padding: "1rem",
          backgroundColor: "var(--color-surface-dark, #1e1e1e)",
          fontFamily: "monospace",
          fontSize: "0.85rem",
          lineHeight: "1.5",
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
        }}
      >
        {logs}
        <div ref={logsEndRef} />
      </div>
    </div>
  );
};

export default DeploymentLogs;
