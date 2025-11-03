import { useState, useEffect, useCallback, useMemo } from "react";
import { useAuth } from "./context/AuthContext";
import LoginPage from "./pages/LoginPage";
import SessionList from "./components/SessionList";
import ServiceIframe from "./components/ServiceIframe";
import AdminPanel from "./components/AdminPanel";
import DokployPanel from "./components/DokployPanel";
import GitHubConnectionPanel from "./components/GitHubConnectionPanel";
import NewSessionModal from "./components/NewSessionModal";
import DeploymentLogs from "./components/DeploymentLogs";
import { createSession, deleteSession, fetchSessions } from "./api/client";
import type { Session } from "@codex-webapp/shared";

const TAGLINES = [
  "webedt - (wĕb ĕd′-ĭt)",
  "webedt - There's not i in webedt",
  "webedt - It edits!",
  "webedt - From that time where we took off the last vowels",
];

type Theme = "light" | "dark";

function AppSimplified() {
  const { user, logout } = useAuth();
  const [theme, setTheme] = useState<Theme>("dark");
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"service" | "admin" | "dokploy" | "github">("service");
  const [loading, setLoading] = useState(true);
  const [serviceStatuses, setServiceStatuses] = useState<Record<string, any>>({});
  const [isNewSessionModalOpen, setIsNewSessionModalOpen] = useState(false);
  const tagline = useMemo(() => TAGLINES[Math.floor(Math.random() * TAGLINES.length)], []);

  const activeSession = useMemo(
    () => sessions.find((s) => s.id === activeSessionId) ?? null,
    [sessions, activeSessionId]
  );

  // Load sessions on mount
  useEffect(() => {
    if (!user) return;

    let cancelled = false;

    async function loadSessions() {
      try {
        const data = await fetchSessions();
        if (cancelled) return;

        const sorted = [...data].sort(
          (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
        );

        setSessions(sorted);
        setActiveSessionId((prev) => prev ?? sorted[0]?.id ?? null);
      } catch (error) {
        console.error("Failed to load sessions:", error);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadSessions();

    return () => {
      cancelled = true;
    };
  }, [user]);

  // Load service statuses with polling for non-ready services
  useEffect(() => {
    if (!user || sessions.length === 0) return;

    let cancelled = false;

    async function loadServiceStatuses() {
      const statuses: Record<string, any> = {};

      for (const session of sessions) {
        try {
          const response = await fetch(`/api/sessions/${session.id}/service/status`);
          if (response.ok) {
            const data = await response.json();
            statuses[session.id] = data;
          }
        } catch (error) {
          // Ignore errors for individual services
        }
      }

      if (!cancelled) {
        setServiceStatuses(statuses);
      }

      // Poll for status updates if any service is not running
      const hasNonRunningServices = Object.values(statuses).some(
        (s) => s?.status && s.status !== "running"
      );

      if (hasNonRunningServices && !cancelled) {
        setTimeout(loadServiceStatuses, 3000); // Poll every 3 seconds
      }
    }

    loadServiceStatuses();

    return () => {
      cancelled = true;
    };
  }, [user, sessions]);

  const handleNewSession = useCallback(() => {
    setIsNewSessionModalOpen(true);
  }, []);

  const handleCreateSession = useCallback(async (data: {
    title?: string;
    githubRepo?: string;
    gitBranch?: string;
    dockerfilePath?: string;
    customEnvVars?: Record<string, string>;
  }) => {
    try {
      const newSession = await createSession(data);
      setSessions((prev) => [newSession, ...prev]);
      setActiveSessionId(newSession.id);

      // Create service for the new session
      await fetch(`/api/sessions/${newSession.id}/service/create`, {
        method: "POST",
      });
    } catch (error) {
      console.error("Failed to create session:", error);
      throw error; // Re-throw so modal can show error
    }
  }, []);

  const handleDeleteSession = useCallback(async (sessionId: string) => {
    try {
      await deleteSession(sessionId);
      setSessions((prev) => prev.filter((s) => s.id !== sessionId));
      if (activeSessionId === sessionId) {
        setActiveSessionId((prev) => {
          const remaining = sessions.filter((s) => s.id !== sessionId);
          return remaining[0]?.id ?? null;
        });
      }
    } catch (error) {
      console.error("Failed to delete session:", error);
      alert("Failed to delete session");
    }
  }, [activeSessionId, sessions]);

  const toggleTheme = useCallback(() => {
    setTheme((prev) => {
      const next = prev === "dark" ? "light" : "dark";
      document.documentElement.dataset.theme = next;
      return next;
    });
  }, []);

  const handleLogout = useCallback(async () => {
    try {
      await logout();
    } catch (error) {
      console.error("Failed to log out:", error);
    }
  }, [logout]);

  // Set initial theme
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  if (!user) {
    return <LoginPage />;
  }

  if (loading) {
    return (
      <div className="app-loading">
        <p>Loading...</p>
      </div>
    );
  }

  const serviceStatus = activeSessionId ? serviceStatuses[activeSessionId] : null;
  const serviceUrl = serviceStatus?.url;
  const isServiceReady = serviceStatus?.status === "running" && serviceUrl;

  const getStatusMessage = (status?: string) => {
    switch (status) {
      case "creating":
        return "Creating service container...";
      case "running":
        return "Service is ready!";
      case "stopped":
        return "Service is stopped";
      case "error":
        return "Service encountered an error";
      default:
        return "Initializing...";
    }
  };

  return (
    <div className="app-layout">
      {/* Top Bar */}
      <header className="app-header">
        <div className="header-left">
          <h1 className="app-title">{tagline}</h1>
        </div>

        <div className="header-right">
          <button
            type="button"
            className="ghost-button"
            onClick={() => setViewMode("github")}
            aria-label="GitHub"
          >
            GitHub
          </button>
          <button
            type="button"
            className="ghost-button"
            onClick={() => setViewMode("admin")}
            aria-label="Admin"
          >
            Admin
          </button>
          <button
            type="button"
            className="ghost-button"
            onClick={() => setViewMode("dokploy")}
            aria-label="Dokploy"
          >
            Dokploy
          </button>
          <button
            type="button"
            className="ghost-button"
            onClick={handleLogout}
            aria-label="Logout"
          >
            Logout
          </button>
          <button
            type="button"
            className="ghost-button"
            onClick={toggleTheme}
            aria-label="Toggle theme"
          >
            {theme === "dark" ? "☀️" : "🌙"}
          </button>
        </div>
      </header>

      {/* Main Content */}
      <div className="app-content">
        {/* Left Sidebar - Session List */}
        <SessionList
          sessions={sessions}
          activeSessionId={activeSessionId}
          onSelectSession={(id) => {
            setActiveSessionId(id);
            setViewMode("service");
          }}
          onNewSession={handleNewSession}
          onDeleteSession={handleDeleteSession}
          serviceStatuses={serviceStatuses}
        />

        {/* Right Panel */}
        <div className="app-main-panel">
          {viewMode === "admin" ? (
            <div className="message-panel">
              <AdminPanel />
            </div>
          ) : viewMode === "dokploy" ? (
            <div className="message-panel">
              <DokployPanel />
            </div>
          ) : viewMode === "github" ? (
            <div className="message-panel">
              <GitHubConnectionPanel />
            </div>
          ) : activeSession && isServiceReady ? (
            <ServiceIframe serviceUrl={serviceUrl} sessionId={activeSession.id} />
          ) : activeSession && serviceStatus?.status === "creating" ? (
            <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
              <div style={{ padding: "1.5rem", borderBottom: "1px solid var(--color-border)" }}>
                <h3 style={{ margin: "0 0 0.5rem 0" }}>
                  ⏳ {getStatusMessage(serviceStatus?.status)}
                </h3>
                <p style={{ margin: "0", opacity: 0.8 }}>
                  Your session service is being built and deployed...
                </p>
              </div>
              <div style={{ flex: 1, overflow: "hidden" }}>
                <DeploymentLogs
                  sessionId={activeSession.id}
                  onComplete={() => {
                    // Refresh service status when deployment completes
                    setTimeout(() => {
                      window.location.reload();
                    }, 2000);
                  }}
                />
              </div>
            </div>
          ) : activeSession ? (
            <div className="service-loading">
              <h3>
                {serviceStatus?.status === "error" && "❌ "}
                {getStatusMessage(serviceStatus?.status)}
              </h3>
              <p>Your session service status is being checked.</p>
              <div style={{ marginTop: "1rem", fontSize: "0.9rem", opacity: 0.8 }}>
                <p><strong>Status:</strong> {serviceStatus?.status || "unknown"}</p>
                {serviceUrl && <p><strong>URL:</strong> {serviceUrl}</p>}
                {serviceStatus?.error && (
                  <p style={{ color: "var(--color-error-text)", marginTop: "0.5rem" }}>
                    <strong>Error:</strong> {serviceStatus.error}
                  </p>
                )}
              </div>
            </div>
          ) : (
            <div className="service-loading">
              <h3>No Session Selected</h3>
              <p>Create or select a session to get started.</p>
            </div>
          )}
        </div>
      </div>

      {/* New Session Modal */}
      <NewSessionModal
        isOpen={isNewSessionModalOpen}
        onClose={() => setIsNewSessionModalOpen(false)}
        onCreate={handleCreateSession}
      />
    </div>
  );
}

export default AppSimplified;
