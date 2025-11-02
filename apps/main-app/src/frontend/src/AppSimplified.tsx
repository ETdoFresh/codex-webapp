import { useState, useEffect, useCallback, useMemo } from "react";
import { useAuth } from "./context/AuthContext";
import LoginPage from "./pages/LoginPage";
import SessionList from "./components/SessionList";
import ServiceIframe from "./components/ServiceIframe";
import AdminPanel from "./components/AdminPanel";
import DokployPanel from "./components/DokployPanel";
import NewSessionModal from "./components/NewSessionModal";
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
  const [viewMode, setViewMode] = useState<"service" | "admin" | "dokploy">("service");
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

  // Load service statuses
  useEffect(() => {
    if (!user || sessions.length === 0) return;

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

      setServiceStatuses(statuses);
    }

    loadServiceStatuses();
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
            onClick={toggleTheme}
            aria-label="Toggle theme"
          >
            {theme === "dark" ? "☀️" : "🌙"}
          </button>
          <button
            type="button"
            className="ghost-button"
            onClick={handleLogout}
            aria-label="Logout"
          >
            Logout
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
          ) : activeSession && serviceUrl ? (
            <ServiceIframe serviceUrl={serviceUrl} sessionId={activeSession.id} />
          ) : activeSession ? (
            <div className="service-loading">
              <h3>Service Starting...</h3>
              <p>Your session service is being provisioned.</p>
              <p>Status: {serviceStatus?.status || "unknown"}</p>
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
