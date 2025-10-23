import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ApiError,
  fetchWorkspaceFileContent,
  fetchWorkspaceFiles,
  saveWorkspaceFile
} from '../api/client';
import type { WorkspaceFile, WorkspaceFileContent } from '../api/types';

type FileEditorPanelProps = {
  sessionId: string;
};

const fileTimestampFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short'
});

const formatFileSize = (bytes: number): string => {
  if (Number.isNaN(bytes) || bytes < 0) {
    return '0 B';
  }
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const extractErrorMessage = (error: unknown, fallback: string): string => {
  if (error instanceof ApiError) {
    const body = error.body;
    if (body && typeof body === 'object') {
      const record = body as Record<string, unknown>;
      const baseMessage =
        (typeof record.error === 'string' && record.error.trim().length > 0
          ? record.error
          : typeof record.message === 'string' && record.message.trim().length > 0
            ? record.message
            : null) ?? fallback;

      if (typeof record.maxBytes === 'number') {
        return `${baseMessage} (limit ${formatFileSize(record.maxBytes)}).`;
      }

      return baseMessage;
    }
    if (typeof error.message === 'string' && error.message.trim().length > 0) {
      return error.message;
    }
  } else if (error instanceof Error) {
    return error.message;
  }

  return fallback;
};

const shouldConfirmDiscard = (
  hasUnsavedChanges: boolean,
  destinationPath: string,
  currentPath: string | null
): boolean => {
  if (!hasUnsavedChanges) {
    return true;
  }
  if (typeof window === 'undefined') {
    return true;
  }
  const message =
    currentPath && currentPath !== destinationPath
      ? `Discard unsaved changes to ${currentPath}?`
      : 'Discard unsaved changes?';
  return window.confirm(message);
};

const FileEditorPanel = ({ sessionId }: FileEditorPanelProps) => {
  const [files, setFiles] = useState<WorkspaceFile[]>([]);
  const [loadingFiles, setLoadingFiles] = useState(true);
  const [filesError, setFilesError] = useState<string | null>(null);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [activeFile, setActiveFile] = useState<WorkspaceFileContent | null>(null);
  const [loadingFile, setLoadingFile] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [editorValue, setEditorValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null);

  const filesRequestId = useRef(0);
  const fileRequestId = useRef(0);

  const loadFiles = useCallback(async () => {
    const requestId = ++filesRequestId.current;
    setLoadingFiles(true);
    setFilesError(null);

    try {
      const list = await fetchWorkspaceFiles(sessionId);
      if (filesRequestId.current !== requestId) {
        return;
      }
      setFiles(list);
    } catch (error) {
      if (filesRequestId.current !== requestId) {
        return;
      }
      setFiles([]);
      setFilesError(extractErrorMessage(error, 'Unable to load workspace files.'));
    } finally {
      if (filesRequestId.current === requestId) {
        setLoadingFiles(false);
      }
    }
  }, [sessionId]);

  useEffect(() => {
    void loadFiles();
    return () => {
      filesRequestId.current += 1;
    };
  }, [loadFiles]);

  useEffect(() => {
    setSelectedPath(null);
    setActiveFile(null);
    setEditorValue('');
    setFileError(null);
    setSaveError(null);
    setSaveSuccess(null);
  }, [sessionId]);

  useEffect(() => {
    if (files.length === 0) {
      return;
    }
    if (selectedPath && !files.some((file) => file.path === selectedPath)) {
      setSelectedPath(null);
    }
  }, [files, selectedPath]);

  useEffect(() => {
    if (!loadingFiles && files.length > 0 && !selectedPath) {
      setSelectedPath(files[0].path);
    }
  }, [files, loadingFiles, selectedPath]);

  const loadFile = useCallback(
    async (path: string) => {
      const requestId = ++fileRequestId.current;
      setLoadingFile(true);
      setFileError(null);
      setSaveError(null);
      setSaveSuccess(null);
      setActiveFile(null);
      setEditorValue('');

      try {
        const file = await fetchWorkspaceFileContent(sessionId, path);
        if (fileRequestId.current !== requestId) {
          return;
        }
        setActiveFile(file);
        setEditorValue(file.content);
        setFiles((previous) => {
          const index = previous.findIndex((item) => item.path === file.path);
          if (index === -1) {
            return previous;
          }
          const next = [...previous];
          next[index] = {
            path: file.path,
            size: file.size,
            updatedAt: file.updatedAt
          };
          return next;
        });
      } catch (error) {
        if (fileRequestId.current !== requestId) {
          return;
        }
        setActiveFile(null);
        setEditorValue('');
        setFileError(extractErrorMessage(error, 'Unable to load file contents.'));
      } finally {
        if (fileRequestId.current === requestId) {
          setLoadingFile(false);
        }
      }
    },
    [sessionId]
  );

  useEffect(() => {
    if (!selectedPath) {
      setActiveFile(null);
      setEditorValue('');
      return;
    }
    void loadFile(selectedPath);
    return () => {
      fileRequestId.current += 1;
    };
  }, [selectedPath, loadFile]);

  useEffect(() => {
    if (!saveSuccess) {
      return;
    }

    const timeout = window.setTimeout(() => {
      setSaveSuccess(null);
    }, 4000);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [saveSuccess]);

  const selectedFileMeta = useMemo(
    () => files.find((file) => file.path === selectedPath) ?? null,
    [files, selectedPath]
  );

  const isDirty = activeFile ? editorValue !== activeFile.content : false;

  const handleSelectFile = (path: string) => {
    if (path === selectedPath) {
      return;
    }
    if (!shouldConfirmDiscard(isDirty, path, activeFile?.path ?? null)) {
      return;
    }
    setSelectedPath(path);
  };

  const handleRefreshFiles = () => {
    void loadFiles();
  };

  const handleEditorChange = (value: string) => {
    setEditorValue(value);
    setSaveError(null);
  };

  const handleRevertChanges = () => {
    if (!activeFile) {
      return;
    }
    setEditorValue(activeFile.content);
    setSaveError(null);
    setSaveSuccess(null);
  };

  const handleSaveFile = async () => {
    if (!activeFile) {
      return;
    }

    setSaving(true);
    setSaveError(null);
    setSaveSuccess(null);

    try {
      const updated = await saveWorkspaceFile(sessionId, {
        path: activeFile.path,
        content: editorValue
      });
      setActiveFile(updated);
      setEditorValue(updated.content);
      setFiles((previous) => {
        const index = previous.findIndex((item) => item.path === updated.path);
        if (index === -1) {
          return [...previous, { path: updated.path, size: updated.size, updatedAt: updated.updatedAt }];
        }
        const next = [...previous];
        next[index] = {
          path: updated.path,
          size: updated.size,
          updatedAt: updated.updatedAt
        };
        return next;
      });
      setSaveSuccess('Saved just now.');
    } catch (error) {
      setSaveError(extractErrorMessage(error, 'Unable to save file.'));
    } finally {
      setSaving(false);
    }
  };

  const handleCreateFile = () => {
    if (typeof window === 'undefined') {
      return;
    }
    const suggested = 'new-file.txt';
    const input = window.prompt('Enter a workspace-relative file path:', suggested);
    if (!input) {
      return;
    }
    const trimmed = input.trim();
    if (!trimmed) {
      return;
    }
    if (!shouldConfirmDiscard(isDirty, trimmed, activeFile?.path ?? null)) {
      return;
    }
    setSelectedPath(trimmed);
    setActiveFile({
      path: trimmed,
      size: 0,
      updatedAt: new Date().toISOString(),
      content: ''
    });
    setEditorValue('');
    setFileError(null);
    setSaveError(null);
    setSaveSuccess(null);
  };

  const fileStatusText = useMemo(() => {
    const target = activeFile ?? selectedFileMeta;
    if (!target) {
      return null;
    }
    const formattedSize = formatFileSize(target.size);
    const formattedTimestamp = fileTimestampFormatter.format(new Date(target.updatedAt));
    return `${formattedSize} • Updated ${formattedTimestamp}`;
  }, [activeFile, selectedFileMeta]);

  return (
    <div className="file-editor">
      <aside className="file-editor-sidebar">
        <div className="file-editor-sidebar-header">
          <h3>Workspace Files</h3>
          <div className="file-editor-sidebar-actions">
            <button type="button" className="ghost-button" onClick={handleCreateFile}>
              New File
            </button>
            <button
              type="button"
              className="ghost-button"
              onClick={handleRefreshFiles}
              disabled={loadingFiles}
            >
              {loadingFiles ? 'Refreshing…' : 'Refresh'}
            </button>
          </div>
        </div>
        {filesError ? (
          <p className="file-editor-error">{filesError}</p>
        ) : loadingFiles ? (
          <p className="file-editor-muted">Loading files…</p>
        ) : files.length === 0 ? (
          <p className="file-editor-muted">
            No files yet. Generate or upload files through the chat agent to start editing.
          </p>
        ) : (
          <ul className="file-editor-list">
            {files.map((file) => (
              <li key={file.path}>
                <button
                  type="button"
                  className={`file-editor-file-button${selectedPath === file.path ? ' active' : ''}`}
                  onClick={() => handleSelectFile(file.path)}
                >
                  <span className="file-editor-file-name">{file.path}</span>
                  <span className="file-editor-file-meta">
                    {formatFileSize(file.size)} •{' '}
                    {fileTimestampFormatter.format(new Date(file.updatedAt))}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </aside>

      <section className="file-editor-main">
        {!selectedPath ? (
          <div className="file-editor-placeholder">Select a file to load it into the editor.</div>
        ) : loadingFile ? (
          <div className="file-editor-placeholder">Loading file…</div>
        ) : fileError ? (
          <div className="file-editor-error">{fileError}</div>
        ) : (
          <div className="file-editor-content">
            <header className="file-editor-header">
              <div>
                <h3 className="file-editor-title">{selectedPath}</h3>
                {fileStatusText ? (
                  <p className="file-editor-subtitle">{fileStatusText}</p>
                ) : null}
              </div>
              <div className="file-editor-toolbar">
                {saveError ? (
                  <span className="file-editor-status file-editor-status-error">{saveError}</span>
                ) : null}
                {saveSuccess ? (
                  <span className="file-editor-status file-editor-status-success">{saveSuccess}</span>
                ) : null}
                <button
                  type="button"
                  className="ghost-button"
                  onClick={handleRevertChanges}
                  disabled={!isDirty || saving || !activeFile}
                >
                  Revert
                </button>
                <button
                  type="button"
                  onClick={handleSaveFile}
                  disabled={!isDirty || saving || !activeFile}
                >
                  {saving ? 'Saving…' : 'Save Changes'}
                </button>
              </div>
            </header>
            <textarea
              className="file-editor-textarea"
              value={editorValue}
              onChange={(event) => handleEditorChange(event.target.value)}
              placeholder="File is empty."
              disabled={!activeFile}
              spellCheck={false}
            />
          </div>
        )}
      </section>
    </div>
  );
};

export default FileEditorPanel;
