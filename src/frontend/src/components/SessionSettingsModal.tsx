import { FormEvent, useState } from "react";

export type SessionSettings = {
  title: string;
  githubRepo: string;
  customEnvVars: Record<string, string>;
  dockerfilePath: string;
  buildSettings: Record<string, unknown>;
};

type Props = {
  open: boolean;
  onClose: () => void;
  onSubmit: (settings: SessionSettings) => void | Promise<void>;
};

const SessionSettingsModal = ({ open, onClose, onSubmit }: Props) => {
  const [title, setTitle] = useState("");
  const [githubRepo, setGithubRepo] = useState("");
  const [dockerfilePath, setDockerfilePath] = useState("");
  const [envVars, setEnvVars] = useState<Array<{ key: string; value: string }>>([
    { key: "", value: "" },
  ]);
  const [submitting, setSubmitting] = useState(false);

  const handleAddEnvVar = () => {
    setEnvVars([...envVars, { key: "", value: "" }]);
  };

  const handleRemoveEnvVar = (index: number) => {
    setEnvVars(envVars.filter((_, i) => i !== index));
  };

  const handleEnvVarChange = (
    index: number,
    field: "key" | "value",
    value: string,
  ) => {
    const updated = [...envVars];
    updated[index][field] = value;
    setEnvVars(updated);
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);

    const customEnvVars: Record<string, string> = {};
    for (const item of envVars) {
      if (item.key.trim()) {
        customEnvVars[item.key.trim()] = item.value;
      }
    }

    try {
      await onSubmit({
        title: title.trim() || "New Session",
        githubRepo: githubRepo.trim(),
        customEnvVars,
        dockerfilePath: dockerfilePath.trim(),
        buildSettings: {},
      });

      // Reset form
      setTitle("");
      setGithubRepo("");
      setDockerfilePath("");
      setEnvVars([{ key: "", value: "" }]);
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) {
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
          backgroundColor: "var(--bg-primary)",
          borderRadius: "8px",
          padding: "2em",
          maxWidth: "600px",
          width: "90%",
          maxHeight: "80vh",
          overflow: "auto",
        }}
      >
        <h2 style={{ marginTop: 0 }}>Create New Session Container</h2>
        <p className="muted" style={{ marginBottom: "1.5em" }}>
          Configure settings for your new container-based session. Each session
          will run in its own isolated Dokploy container.
        </p>

        <form onSubmit={handleSubmit}>
          <label style={{ display: "block", marginBottom: "1em" }}>
            <span style={{ display: "block", marginBottom: "0.5em" }}>
              Session Title
            </span>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="My Project"
              disabled={submitting}
              style={{ width: "100%" }}
            />
          </label>

          <label style={{ display: "block", marginBottom: "1em" }}>
            <span style={{ display: "block", marginBottom: "0.5em" }}>
              GitHub Repository (optional)
            </span>
            <input
              type="url"
              value={githubRepo}
              onChange={(e) => setGithubRepo(e.target.value)}
              placeholder="https://github.com/username/repo"
              disabled={submitting}
              style={{ width: "100%" }}
            />
            <small className="muted">
              Clone this repository into the container workspace
            </small>
          </label>

          <label style={{ display: "block", marginBottom: "1em" }}>
            <span style={{ display: "block", marginBottom: "0.5em" }}>
              Dockerfile Path (optional)
            </span>
            <input
              type="text"
              value={dockerfilePath}
              onChange={(e) => setDockerfilePath(e.target.value)}
              placeholder="./Dockerfile"
              disabled={submitting}
              style={{ width: "100%" }}
            />
            <small className="muted">
              Path to Dockerfile relative to workspace root
            </small>
          </label>

          <div style={{ marginBottom: "1em" }}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: "0.5em",
              }}
            >
              <span>Environment Variables (optional)</span>
              <button
                type="button"
                onClick={handleAddEnvVar}
                disabled={submitting}
                className="ghost-button"
              >
                Add Variable
              </button>
            </div>

            {envVars.map((envVar, index) => (
              <div
                key={index}
                style={{
                  display: "flex",
                  gap: "0.5em",
                  marginBottom: "0.5em",
                  alignItems: "center",
                }}
              >
                <input
                  type="text"
                  value={envVar.key}
                  onChange={(e) =>
                    handleEnvVarChange(index, "key", e.target.value)
                  }
                  placeholder="KEY"
                  disabled={submitting}
                  style={{ flex: "1" }}
                />
                <input
                  type="text"
                  value={envVar.value}
                  onChange={(e) =>
                    handleEnvVarChange(index, "value", e.target.value)
                  }
                  placeholder="value"
                  disabled={submitting}
                  style={{ flex: "2" }}
                />
                <button
                  type="button"
                  onClick={() => handleRemoveEnvVar(index)}
                  disabled={submitting || envVars.length === 1}
                  className="danger-link"
                  style={{ padding: "0.5em" }}
                >
                  ×
                </button>
              </div>
            ))}
          </div>

          <div
            style={{
              display: "flex",
              gap: "1em",
              justifyContent: "flex-end",
              marginTop: "2em",
            }}
          >
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="ghost-button"
            >
              Cancel
            </button>
            <button type="submit" disabled={submitting}>
              {submitting ? "Creating…" : "Create Session"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default SessionSettingsModal;
