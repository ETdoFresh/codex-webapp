import type { Session } from "@codex-webapp/shared";

type SessionListProps = {
  sessions: Session[];
  activeSessionId: string | null;
  onSelectSession: (sessionId: string) => void;
  onNewSession: () => void;
  onDeleteSession: (sessionId: string) => void;
  containerStatuses: Record<string, { status: string; url?: string }>;
};

const formatSessionDate = (dateString: string): string => {
  try {
    const date = new Date(dateString);
    return new Intl.DateTimeFormatter(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
    }).format(date);
  } catch (error) {
    return dateString;
  }
};

const SessionList = ({
  sessions,
  activeSessionId,
  onSelectSession,
  onNewSession,
  onDeleteSession,
  containerStatuses,
}: SessionListProps) => {
  const getStatusIcon = (status?: string) => {
    switch (status) {
      case "running":
        return "🟢";
      case "creating":
        return "🟡";
      case "stopped":
        return "🔴";
      case "error":
        return "⚠️";
      default:
        return "⚪";
    }
  };

  return (
    <div className="session-sidebar">
      <div className="session-sidebar-header">
        <h2>Sessions</h2>
        <button
          type="button"
          className="ghost-button"
          onClick={onNewSession}
          aria-label="Create new session"
        >
          + New
        </button>
      </div>

      <div className="session-list">
        {sessions.length === 0 ? (
          <div className="session-empty">
            <p>No sessions yet</p>
            <button className="ghost-button" onClick={onNewSession}>
              Create First Session
            </button>
          </div>
        ) : (
          sessions.map((session) => {
            const isActive = session.id === activeSessionId;
            const containerStatus = containerStatuses[session.id];

            return (
              <div
                key={session.id}
                className={`session-item ${isActive ? "session-item-active" : ""}`}
                onClick={() => onSelectSession(session.id)}
              >
                <div className="session-item-header">
                  <div className="session-item-title">
                    {session.titleLocked && (
                      <span className="session-lock-icon" title="Title locked">
                        🔒
                      </span>
                    )}
                    {session.title}
                  </div>
                  <button
                    type="button"
                    className="session-delete-button"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (window.confirm(`Delete session "${session.title}"?`)) {
                        onDeleteSession(session.id);
                      }
                    }}
                    aria-label="Delete session"
                  >
                    ×
                  </button>
                </div>

                <div className="session-item-meta">
                  <span>{formatSessionDate(session.updatedAt)}</span>
                  {containerStatus && (
                    <span className="session-container-status" title={containerStatus.status}>
                      {getStatusIcon(containerStatus.status)}
                    </span>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};

export default SessionList;
