import {
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ApiError,
  browseSessionWorkspaceDirectories,
  updateSessionWorkspacePath,
} from "../api/client";
import type {
  BrowseWorkspaceResponse,
  Session,
  SessionWorkspaceInfo,
} from "../api/types";

type WorkspaceRootModalProps = {
  open: boolean;
  session: Session | null;
  workspaceInfo: SessionWorkspaceInfo | null;
  onClose: () => void;
  onWorkspaceUpdated: (
    session: Session,
    info: SessionWorkspaceInfo,
  ) => void;
};

const extractErrorMessage = (error: unknown, fallback: string): string => {
  if (error instanceof ApiError) {
    const body = error.body as { error?: unknown };
    if (
      body &&
      typeof body.error === "string" &&
      body.error.trim().length > 0
    ) {
      return body.error;
    }
  }
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  return fallback;
};

function WorkspaceRootModal({
  open,
  session,
  workspaceInfo,
  onClose,
  onWorkspaceUpdated,
}: WorkspaceRootModalProps) {
  const [manualPath, setManualPath] = useState("");
  const [listing, setListing] = useState<BrowseWorkspaceResponse | null>(null);
  const [loadingListing, setLoadingListing] = useState(false);
  const [listingError, setListingError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const requestTokenRef = useRef(0);

  const sessionId = session?.id ?? null;
  const sessionTitle = session?.title ?? "Current Session";

  const currentPath =
    listing?.targetPath ??
    workspaceInfo?.path ??
    session?.workspacePath ??
    "";
  const canUseDirectory =
    !!sessionId &&
    !!listing &&
    (listing.exists ? listing.isDirectory : listing.canCreate);

  const quickAccess = useMemo(() => {
    if (listing && listing.quickAccess.length > 0) {
      return listing.quickAccess;
    }
    const candidates = [
      workspaceInfo?.path ?? null,
      workspaceInfo?.defaultPath ?? null,
      session?.workspacePath ?? null,
      manualPath || null,
    ];
    return Array.from(
      new Set(
        candidates.filter((item): item is string =>
          typeof item === "string" && item.length > 0,
        ),
      ),
    );
  }, [listing, workspaceInfo, session, manualPath]);

  const resetState = useCallback(() => {
    requestTokenRef.current += 1;
    setListing(null);
    setListingError(null);
    setManualPath("");
    setSubmitError(null);
    setSubmitting(false);
    setLoadingListing(false);
  }, []);

  const loadPath = useCallback(
    async (pathToLoad: string) => {
      if (!sessionId) {
        setListingError("Select a session before choosing a workspace.");
        return;
      }

      const token = requestTokenRef.current + 1;
      requestTokenRef.current = token;
      setLoadingListing(true);
      setListingError(null);
      try {
        const response = await browseSessionWorkspaceDirectories(
          sessionId,
          pathToLoad,
        );
        if (requestTokenRef.current !== token) {
          return;
        }
        setListing(response);
        setManualPath(response.targetPath);
      } catch (error) {
        if (requestTokenRef.current !== token) {
          return;
        }
        setListing(null);
        setListingError(
          extractErrorMessage(error, "Unable to browse the selected path."),
        );
      } finally {
        if (requestTokenRef.current === token) {
          setLoadingListing(false);
        }
      }
    },
    [sessionId],
  );

  useEffect(() => {
    if (!open) {
      resetState();
      return;
    }

    if (!sessionId) {
      setListingError("Select a session to choose a workspace.");
      setListing(null);
      return;
    }

    const initialPath = workspaceInfo?.path ?? session?.workspacePath ?? "";
    if (initialPath) {
      setManualPath(initialPath);
      void loadPath(initialPath);
    } else {
      setManualPath("");
      setListing(null);
    }
  }, [
    open,
    sessionId,
    session?.workspacePath,
    workspaceInfo?.path,
    loadPath,
    resetState,
  ]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, onClose]);

  if (!open) {
    return null;
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!manualPath.trim()) {
      setListingError("Enter a directory path to browse.");
      return;
    }
    void loadPath(manualPath);
  };

  const handleConfirm = async () => {
    if (!listing) {
      return;
    }

    if (!sessionId) {
      setSubmitError("Select a session before choosing a workspace.");
      return;
    }

    setSubmitting(true);
    setSubmitError(null);
    try {
      const result = await updateSessionWorkspacePath(
        sessionId,
        listing.targetPath,
      );
      onWorkspaceUpdated(result.session, result.workspace);
      onClose();
    } catch (error) {
      setSubmitError(
        extractErrorMessage(error, "Unable to update workspace directory."),
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleNavigate = (pathToNavigate: string) => {
    setManualPath(pathToNavigate);
    void loadPath(pathToNavigate);
  };

  return (
    <div
      className="workspace-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="workspace-modal-title"
    >
      <div className="workspace-modal">
        <header className="workspace-modal-header">
          <div>
            <h2 id="workspace-modal-title">
              Change Workspace Directory
              {session ? ` — ${sessionTitle}` : ""}
            </h2>
            {workspaceInfo ? (
              <p
                className="workspace-modal-subtitle"
                title={workspaceInfo.path}
              >
                Current: <code>{workspaceInfo.path}</code>
              </p>
            ) : session ? (
              <p
                className="workspace-modal-subtitle"
                title={session.workspacePath}
              >
                Current: <code>{session.workspacePath}</code>
              </p>
            ) : (
              <p className="workspace-modal-subtitle">
                Select a session to choose a workspace.
              </p>
            )}
          </div>
          <button
            type="button"
            className="workspace-modal-close"
            onClick={onClose}
            aria-label="Close workspace dialog"
          >
            ×
          </button>
        </header>

        <form className="workspace-modal-search" onSubmit={handleSubmit}>
          <label
            htmlFor="workspace-path-input"
            className="workspace-modal-label"
          >
            Browse to a folder
          </label>
          <div className="workspace-modal-search-row">
            <input
              id="workspace-path-input"
              type="text"
              value={manualPath}
              onChange={(event) => setManualPath(event.target.value)}
              placeholder="Enter an absolute path (supports ~ for home)"
              spellCheck={false}
            />
            <button
              type="submit"
              className="ghost-button"
              disabled={loadingListing || !sessionId}
            >
              {loadingListing ? "Loading…" : "Go"}
            </button>
          </div>
        </form>

        <div className="workspace-modal-body">
          <aside
            className="workspace-modal-quick-access"
            aria-label="Quick access paths"
          >
            <h3>Quick access</h3>
            <div className="workspace-modal-quick-list">
              {quickAccess.length === 0 ? (
                <span className="workspace-modal-muted">
                  No suggestions available.
                </span>
              ) : (
                quickAccess.map((entry) => (
                  <button
                    key={entry}
                    type="button"
                    className="workspace-modal-quick-button"
                    onClick={() => handleNavigate(entry)}
                    title={entry}
                  >
                    {entry}
                  </button>
                ))
              )}
            </div>
          </aside>

          <section className="workspace-modal-directory" aria-live="polite">
            <div className="workspace-modal-pathbar">
              <div className="workspace-modal-path" title={currentPath}>
                {currentPath || "Select a directory to preview."}
              </div>
              {listing?.parentPath ? (
                <button
                  type="button"
                  className="workspace-modal-up"
                  onClick={() => handleNavigate(listing.parentPath!)}
                  disabled={loadingListing}
                >
                  Up one level
                </button>
              ) : null}
            </div>

            {listingError ? (
              <div className="workspace-modal-error">{listingError}</div>
            ) : null}
            {listing?.error ? (
              <div className="workspace-modal-warning">{listing.error}</div>
            ) : null}

            {loadingListing && !listing ? (
              <div className="workspace-modal-loading">Loading directory…</div>
            ) : listing ? (
              listing.entries.length === 0 ? (
                <div className="workspace-modal-empty">
                  {listing.exists
                    ? "This folder has no subdirectories."
                    : listing.canCreate
                      ? "This folder does not exist yet. It will be created if you continue."
                      : "This folder does not exist."}
                </div>
              ) : (
                <ul className="workspace-modal-list">
                  {listing.entries.map((entry) => (
                    <li key={entry.path}>
                      <button
                        type="button"
                        onClick={() => handleNavigate(entry.path)}
                        disabled={loadingListing}
                      >
                        {entry.name}
                      </button>
                    </li>
                  ))}
                </ul>
              )
            ) : null}

            {listing?.entriesTruncated ? (
              <div className="workspace-modal-warning">
                Showing the first {listing.entries.length} folders. Refine the
                path for a smaller listing.
              </div>
            ) : null}
          </section>
        </div>

        <footer className="workspace-modal-footer">
          {submitError ? (
            <div className="workspace-modal-error">{submitError}</div>
          ) : null}
          {listing && !listing.exists && listing.canCreate ? (
            <div className="workspace-modal-note">
              The workspace folder will be created at{" "}
              <code>{listing.targetPath}</code>.
            </div>
          ) : null}
          <div className="workspace-modal-actions">
            <button
              type="button"
              className="ghost-button"
              onClick={onClose}
              disabled={submitting}
            >
              Cancel
            </button>
            <button
              type="button"
              className="workspace-modal-confirm"
              onClick={handleConfirm}
              disabled={submitting || !canUseDirectory}
            >
              {submitting ? "Saving…" : "Use This Folder"}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}

export default WorkspaceRootModal;
