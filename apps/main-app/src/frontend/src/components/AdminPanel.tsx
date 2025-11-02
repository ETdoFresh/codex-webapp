import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  createUser,
  deleteUser,
  fetchUserAuthFiles,
  fetchUsers,
  saveUserAuthFile,
  updateUser,
  deleteUserAuthFile,
  downloadUserAuthFile,
  impersonateUser,
} from "../api/client";
import type {
  AuthUser,
  CreateUserRequest,
  UserAuthFileSummary,
} from "../api/types";
import { useAuth } from "../context/AuthContext";

type ProviderKey = UserAuthFileSummary["provider"];

const PROVIDERS: ProviderKey[] = ["codex", "claude", "droid", "copilot"];

const providerLabels: Record<ProviderKey, string> = {
  codex: "Codex CLI",
  claude: "Claude CLI",
  droid: "Droid CLI",
  copilot: "Copilot CLI",
};

const AdminPanel = () => {
  const { user: currentUser } = useAuth();
  const [users, setUsers] = useState<AuthUser[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [usersError, setUsersError] = useState<string | null>(null);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);

  const [createUserForm, setCreateUserForm] = useState<CreateUserRequest & {
    submitting: boolean;
    error: string | null;
  }>({ username: "", password: "", isAdmin: false, submitting: false, error: null });

  const [adminDraft, setAdminDraft] = useState<boolean>(false);
  const [adminSaving, setAdminSaving] = useState(false);
  const [passwordDraft, setPasswordDraft] = useState("");
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordSuccess, setPasswordSuccess] = useState<string | null>(null);

  const [authSummaries, setAuthSummaries] = useState<UserAuthFileSummary[]>([]);
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [authEditorTarget, setAuthEditorTarget] = useState<
    { provider: ProviderKey; fileName: string | null } | null
  >(null);
  const [authEditorFileName, setAuthEditorFileName] = useState("");
  const [authEditorContent, setAuthEditorContent] = useState("");
  const [authEditorSaving, setAuthEditorSaving] = useState(false);
  const [authEditorLoading, setAuthEditorLoading] = useState(false);
  const [authEditorError, setAuthEditorError] = useState<string | null>(null);

  const selectedUser = useMemo(
    () => users.find((candidate) => candidate.id === selectedUserId) ?? null,
    [users, selectedUserId],
  );

  const refreshUsers = useCallback(async () => {
    setLoadingUsers(true);
    setUsersError(null);
    try {
      const list = await fetchUsers();
      setUsers(list);
      if (!selectedUserId && list.length > 0) {
        setSelectedUserId(list[0].id);
        setAdminDraft(list[0].isAdmin);
      }
    } catch (error) {
      console.error("Failed to load users", error);
      setUsersError("Failed to load users");
    } finally {
      setLoadingUsers(false);
    }
  }, [selectedUserId]);

  const refreshAuthFiles = useCallback(async (userId: string) => {
    setAuthLoading(true);
    setAuthError(null);
    try {
      const files = await fetchUserAuthFiles(userId);
      setAuthSummaries(files);
    } catch (error) {
      console.error("Failed to load auth files", error);
      setAuthError("Unable to load auth files for this user");
      setAuthSummaries([]);
    } finally {
      setAuthLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshUsers();
  }, [refreshUsers]);

  useEffect(() => {
    if (selectedUser) {
      setAdminDraft(selectedUser.isAdmin);
      void refreshAuthFiles(selectedUser.id);
    } else {
      setAuthSummaries([]);
      setAdminDraft(false);
    }
    setAuthEditorTarget(null);
    setAuthEditorFileName("");
    setAuthEditorContent("");
    setAuthEditorError(null);
  }, [selectedUser, refreshAuthFiles]);

  const handleCreateUser = async (event: FormEvent) => {
    event.preventDefault();
    if (createUserForm.submitting) {
      return;
    }

    const passwordRegex = /^(?=.*[A-Za-z])(?=.*\d).{8,}$/;
    if (!passwordRegex.test(createUserForm.password)) {
      setCreateUserForm((previous) => ({
        ...previous,
        error: "Password must be at least 8 characters and include a letter and number.",
      }));
      return;
    }

    setCreateUserForm((previous) => ({ ...previous, submitting: true, error: null }));
    try {
      const created = await createUser({
        username: createUserForm.username,
        password: createUserForm.password,
        isAdmin: createUserForm.isAdmin,
      });
      await refreshUsers();
      setSelectedUserId(created.id);
      setCreateUserForm({
        username: "",
        password: "",
        isAdmin: false,
        submitting: false,
        error: null,
      });
    } catch (error: any) {
      console.error("Failed to create user", error);
      const errorMessage = error?.body?.error || "Unable to create user.";
      setCreateUserForm((previous) => ({
        ...previous,
        submitting: false,
        error: errorMessage,
      }));
    }
  };

  const handleDeleteUser = async (userId: string) => {
    if (!window.confirm("Delete this user? This action cannot be undone.")) {
      return;
    }
    try {
      await deleteUser(userId);
      if (userId === selectedUserId) {
        setSelectedUserId(null);
      }
      await refreshUsers();
    } catch (error) {
      console.error("Failed to delete user", error);
      alert("Unable to delete user.");
    }
  };

  const handleImpersonateUser = async (userId: string) => {
    try {
      await impersonateUser(userId);
      window.location.href = "/";
    } catch (error) {
      console.error("Failed to impersonate user", error);
      alert("Unable to impersonate user.");
    }
  };

  const handleSaveAdmin = async () => {
    if (!selectedUser) {
      return;
    }
    if (adminDraft === selectedUser.isAdmin) {
      return;
    }
    setAdminSaving(true);
    try {
      await updateUser(selectedUser.id, { isAdmin: adminDraft });
      await refreshUsers();
    } catch (error) {
      console.error("Failed to update admin status", error);
      alert("Unable to update admin status.");
    } finally {
      setAdminSaving(false);
    }
  };

  const handleUpdatePassword = async (event: FormEvent) => {
    event.preventDefault();
    if (!selectedUser || passwordDraft.trim().length === 0) {
      setPasswordError("Password cannot be empty");
      setPasswordSuccess(null);
      return;
    }
    const passwordRegex = /^(?=.*[A-Za-z])(?=.*\d).{8,}$/;
    if (!passwordRegex.test(passwordDraft.trim())) {
      setPasswordError("Password must be at least 8 characters and include a letter and number.");
      setPasswordSuccess(null);
      return;
    }
    setPasswordError(null);
    setPasswordSuccess(null);
    setPasswordSaving(true);
    try {
      await updateUser(selectedUser.id, { password: passwordDraft.trim() });
      setPasswordDraft("");
      setPasswordSuccess("Password updated successfully!");
      setTimeout(() => setPasswordSuccess(null), 3000);
    } catch (error: any) {
      console.error("Failed to update password", error);
      const errorMessage = error?.body?.error || "Unable to update password.";
      setPasswordError(errorMessage);
    } finally {
      setPasswordSaving(false);
    }
  };

  const openAuthEditor = async (provider: ProviderKey, fileName: string | null) => {
    if (!selectedUser) {
      return;
    }
    setAuthEditorError(null);
    setAuthEditorSaving(false);
    setAuthEditorLoading(Boolean(fileName));
    setAuthEditorTarget({ provider, fileName });
    setAuthEditorFileName(fileName ?? "");

    if (!fileName) {
      setAuthEditorContent("{}");
      setAuthEditorLoading(false);
      return;
    }

    try {
      const detail = await downloadUserAuthFile(selectedUser.id, provider, fileName);
      setAuthEditorContent(formatJson(detail.content));
    } catch (error) {
      console.warn("Failed to load auth file", error);
      setAuthEditorContent("{}");
    } finally {
      setAuthEditorLoading(false);
    }
  };

  const handleSaveAuthFile = async () => {
    if (!selectedUser || !authEditorTarget) {
      return;
    }

    const fileName = authEditorTarget.fileName ?? authEditorFileName.trim();
    if (!fileName) {
      setAuthEditorError("File name is required.");
      return;
    }

    if (!/^[\w.-]+$/.test(fileName)) {
      setAuthEditorError("File name may only include letters, numbers, dots, hyphens, and underscores.");
      return;
    }

    const trimmed = authEditorContent.trim();
    if (trimmed.length === 0) {
      setAuthEditorError("Content cannot be empty.");
      return;
    }

    try {
      const formatted = formatJson(trimmed);
      JSON.parse(formatted);
      setAuthEditorError(null);
      setAuthEditorSaving(true);
      await saveUserAuthFile(selectedUser.id, authEditorTarget.provider, fileName, {
        content: formatted,
      });
      setAuthEditorTarget({ provider: authEditorTarget.provider, fileName });
      setAuthEditorFileName(fileName);
      await refreshAuthFiles(selectedUser.id);
    } catch (error) {
      console.error("Failed to save auth file", error);
      setAuthEditorError("Unable to save auth file. Ensure the JSON is valid.");
    } finally {
      setAuthEditorSaving(false);
    }
  };

  const handleRemoveAuthFile = async (provider: ProviderKey, fileName: string) => {
    if (!selectedUser) {
      return;
    }
    if (
      !window.confirm(
        `Remove ${fileName} for ${providerLabels[provider]}?`,
      )
    ) {
      return;
    }
    try {
      await deleteUserAuthFile(selectedUser.id, provider, fileName);
      await refreshAuthFiles(selectedUser.id);
      if (authEditorTarget && authEditorTarget.provider === provider && authEditorTarget.fileName === fileName) {
        setAuthEditorTarget(null);
        setAuthEditorFileName("");
        setAuthEditorContent("");
      }
    } catch (error) {
      console.error("Failed to remove auth file", error);
      alert("Unable to remove auth file.");
    }
  };

  const getProviderFiles = (provider: ProviderKey) =>
    authSummaries.filter((summary) => summary.provider === provider);

  return (
    <div className="admin-panel">
      <div className="admin-users-column">
        <header>
          <h2>Users</h2>
          {usersError && <span className="error-text">{usersError}</span>}
        </header>
        {loadingUsers ? (
          <div className="placeholder">Loading users…</div>
        ) : (
          <ul className="admin-user-list">
            {users.map((user) => (
              <li
                key={user.id}
                className={user.id === selectedUserId ? "selected" : ""}
              >
                <button
                  type="button"
                  onClick={() => setSelectedUserId(user.id)}
                  className="user-selector"
                >
                  <span>{user.username}</span>
                  {user.isAdmin && <span className="badge">Admin</span>}
                </button>
                {currentUser?.id !== user.id && (
                  <button
                    type="button"
                    className="danger-link"
                    onClick={() => void handleDeleteUser(user.id)}
                    title="Delete user"
                  >
                    Delete
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}

        <form className="admin-create-user" onSubmit={handleCreateUser}>
          <h3>Create User</h3>
          <label>
            Username
            <input
              type="text"
              value={createUserForm.username}
              onChange={(event) =>
                setCreateUserForm((previous) => ({
                  ...previous,
                  username: event.target.value,
                }))
              }
              required
              disabled={createUserForm.submitting}
            />
          </label>
          <label>
            Password
            <input
              type="password"
              value={createUserForm.password}
              onChange={(event) =>
                setCreateUserForm((previous) => ({
                  ...previous,
                  password: event.target.value,
                }))
              }
              required
              disabled={createUserForm.submitting}
            />
            <small className="muted">Must include a letter and number (min. 8 chars)</small>
          </label>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={createUserForm.isAdmin}
              onChange={(event) =>
                setCreateUserForm((previous) => ({
                  ...previous,
                  isAdmin: event.target.checked,
                }))
              }
              disabled={createUserForm.submitting}
            />
            Grant admin access
          </label>
          {createUserForm.error && (
            <div className="error-text">{createUserForm.error}</div>
          )}
          <button type="submit" disabled={createUserForm.submitting}>
            {createUserForm.submitting ? "Creating…" : "Create user"}
          </button>
        </form>
      </div>

      <div className="admin-detail-column">
        {selectedUser ? (
          <>
            <header>
              <h2>{selectedUser.username}</h2>
              <p>
                Created {new Date(selectedUser.createdAt).toLocaleString()} ·
                Updated {new Date(selectedUser.updatedAt).toLocaleString()}
              </p>
              {currentUser?.id !== selectedUser.id && (
                <button
                  type="button"
                  onClick={() => void handleImpersonateUser(selectedUser.id)}
                  style={{
                    marginTop: "1em",
                    backgroundColor: "#6366f1",
                    color: "white",
                    border: "none",
                    padding: "0.5em 1em",
                    borderRadius: "4px",
                    cursor: "pointer",
                  }}
                >
                  View Site as {selectedUser.username}
                </button>
              )}
            </header>

            <section className="admin-section">
              <h3>Account Settings</h3>
              <div className="admin-section-row">
                <label className="checkbox">
                  <input
                    type="checkbox"
                    checked={adminDraft}
                    onChange={(event) => setAdminDraft(event.target.checked)}
                    disabled={adminSaving}
                  />
                  Admin access
                </label>
                <button
                  type="button"
                  onClick={() => void handleSaveAdmin()}
                  disabled={adminSaving || adminDraft === selectedUser.isAdmin}
                >
                  {adminSaving ? "Saving…" : "Save"}
                </button>
              </div>

              <form className="admin-section-row" onSubmit={handleUpdatePassword}>
                <label className="password-field">
                  <span>New password</span>
                  <input
                    type="password"
                    value={passwordDraft}
                    onChange={(event) => {
                      setPasswordDraft(event.target.value);
                      setPasswordError(null);
                      setPasswordSuccess(null);
                    }}
                    disabled={passwordSaving}
                    placeholder="Enter new password"
                  />
                  <small className="muted">Must include a letter and number (min. 8 chars)</small>
                </label>
                <button type="submit" disabled={passwordSaving || passwordDraft.length === 0}>
                  {passwordSaving ? "Updating…" : "Update password"}
                </button>
              </form>
              {passwordError && <div className="error-text">{passwordError}</div>}
              {passwordSuccess && <div style={{ color: "green", fontSize: "0.9em", marginTop: "0.5em" }}>{passwordSuccess}</div>}
            </section>

            <section className="admin-section">
              <h3>Authentication Files</h3>
              {authError && <div className="error-text">{authError}</div>}
              {authLoading ? (
                <div className="placeholder">Loading auth files…</div>
              ) : (
                <div className="auth-providers-grid">
                  {PROVIDERS.map((provider) => {
                    const files = getProviderFiles(provider);
                    const isEditing = authEditorTarget?.provider === provider;
                    return (
                      <div className="auth-card" key={provider}>
                        <header>
                          <h4>{providerLabels[provider]}</h4>
                          <span
                            className={files.length > 0 ? "status configured" : "status missing"}
                          >
                            {files.length > 0 ? "Configured" : "Not set"}
                          </span>
                        </header>
                        <div className="auth-card-files">
                          {files.length === 0 ? (
                            <p className="muted">No files uploaded.</p>
                          ) : (
                            <ul>
                              {files.map((file) => (
                                <li key={file.id}>
                                  <div className="auth-file-info">
                                    <span className="file-name">{file.fileName}</span>
                                    <span className="timestamp">
                                      Updated {new Date(file.updatedAt).toLocaleString()}
                                    </span>
                                  </div>
                                  <div className="auth-file-actions">
                                    <button
                                      type="button"
                                      onClick={() => void openAuthEditor(provider, file.fileName)}
                                    >
                                      Edit
                                    </button>
                                    <button
                                      type="button"
                                      className="danger-link"
                                      onClick={() => void handleRemoveAuthFile(provider, file.fileName)}
                                    >
                                      Remove
                                    </button>
                                  </div>
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                        <div className="auth-card-actions">
                          <button
                            type="button"
                            onClick={() => void openAuthEditor(provider, null)}
                          >
                            Add file
                          </button>
                        </div>
                        {isEditing && (
                          <div className="auth-editor">
                            <label>
                              File name
                              <input
                                type="text"
                                value={authEditorTarget?.fileName ? authEditorTarget.fileName : authEditorFileName}
                                onChange={(event) => setAuthEditorFileName(event.target.value)}
                                disabled={Boolean(authEditorTarget?.fileName)}
                              />
                            </label>
                            {authEditorLoading ? (
                              <div className="placeholder">Loading file…</div>
                            ) : (
                              <textarea
                                value={authEditorContent}
                                onChange={(event) => setAuthEditorContent(event.target.value)}
                                spellCheck={false}
                                rows={10}
                              />
                            )}
                            {authEditorError && (
                              <div className="error-text">{authEditorError}</div>
                            )}
                            <div className="auth-editor-actions">
                              <button
                                type="button"
                                onClick={() => void handleSaveAuthFile()}
                                disabled={authEditorSaving || authEditorLoading}
                              >
                                {authEditorSaving ? "Saving…" : "Save"}
                              </button>
                              <button
                                type="button"
                                className="ghost-button"
                                onClick={() => {
                                  setAuthEditorTarget(null);
                                  setAuthEditorFileName("");
                                  setAuthEditorContent("");
                                  setAuthEditorError(null);
                                }}
                                disabled={authEditorSaving}
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          </>
        ) : (
          <div className="placeholder">Select a user to manage their settings.</div>
        )}
      </div>
    </div>
  );
};

const formatJson = (raw: string): string => {
  try {
    const parsed = JSON.parse(raw);
    return JSON.stringify(parsed, null, 2);
  } catch {
    return raw;
  }
};

export default AdminPanel;
