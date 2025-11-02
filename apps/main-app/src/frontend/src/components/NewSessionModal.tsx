import { useState } from "react";
import "./NewSessionModal.css";

type NewSessionFormData = {
  title: string;
  githubRepo: string;
  gitBranch: string;
  dockerfilePath: string;
  customEnvVars: string; // JSON string
};

const generateBranchName = (): string => {
  const timestamp = Date.now();
  const randomSuffix = Math.random().toString(36).substring(2, 8);
  return `codex-${timestamp}-${randomSuffix}`;
};

type NewSessionModalProps = {
  isOpen: boolean;
  onClose: () => void;
  onCreate: (data: {
    title?: string;
    githubRepo?: string;
    gitBranch?: string;
    dockerfilePath?: string;
    customEnvVars?: Record<string, string>;
  }) => Promise<void>;
};

const NewSessionModal = ({ isOpen, onClose, onCreate }: NewSessionModalProps) => {
  const [formData, setFormData] = useState<NewSessionFormData>({
    title: "",
    githubRepo: "",
    gitBranch: "",
    dockerfilePath: "",
    customEnvVars: "",
  });
  const [error, setError] = useState<string>("");
  const [loading, setLoading] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      // Parse environment variables if provided
      let envVars: Record<string, string> | undefined;
      if (formData.customEnvVars.trim()) {
        try {
          envVars = JSON.parse(formData.customEnvVars);
          if (typeof envVars !== "object" || Array.isArray(envVars)) {
            throw new Error("Must be a JSON object");
          }
        } catch (err) {
          setError(`Invalid JSON for environment variables: ${err instanceof Error ? err.message : "Unknown error"}`);
          setLoading(false);
          return;
        }
      }

      // Build the payload
      const payload: Parameters<typeof onCreate>[0] = {};

      if (formData.title.trim()) {
        payload.title = formData.title.trim();
      }

      if (formData.githubRepo.trim()) {
        payload.githubRepo = formData.githubRepo.trim();
      }

      // Generate a unique branch name if none provided
      if (formData.gitBranch.trim()) {
        payload.gitBranch = formData.gitBranch.trim();
      } else {
        payload.gitBranch = generateBranchName();
      }

      if (formData.dockerfilePath.trim()) {
        payload.dockerfilePath = formData.dockerfilePath.trim();
      }

      if (envVars) {
        payload.customEnvVars = envVars;
      }

      await onCreate(payload);

      // Reset form
      setFormData({
        title: "",
        githubRepo: "",
        gitBranch: "",
        dockerfilePath: "",
        customEnvVars: "",
      });

      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create session");
    } finally {
      setLoading(false);
    }
  };

  const handleChange = (field: keyof NewSessionFormData, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const handleClose = () => {
    if (!loading) {
      setFormData({
        title: "",
        githubRepo: "",
        gitBranch: "",
        dockerfilePath: "",
        customEnvVars: "",
      });
      setError("");
      onClose();
    }
  };

  return (
    <div className="modal-overlay" onClick={handleClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>New Session</h2>
          <button
            type="button"
            className="modal-close-button"
            onClick={handleClose}
            disabled={loading}
            aria-label="Close modal"
          >
            ×
          </button>
        </div>

        <form onSubmit={handleSubmit} className="new-session-form">
          <div className="form-group">
            <label htmlFor="session-title">
              Session Title <span className="optional">(optional)</span>
            </label>
            <input
              id="session-title"
              type="text"
              placeholder="My Project"
              value={formData.title}
              onChange={(e) => handleChange("title", e.target.value)}
              disabled={loading}
            />
            <small className="form-help">
              Leave empty for auto-generated title
            </small>
          </div>

          <div className="form-group">
            <label htmlFor="github-repo">
              GitHub Repository <span className="optional">(optional)</span>
            </label>
            <input
              id="github-repo"
              type="text"
              placeholder="https://github.com/username/repo"
              value={formData.githubRepo}
              onChange={(e) => handleChange("githubRepo", e.target.value)}
              disabled={loading}
            />
            <small className="form-help">
              Optional repository URL to clone into service workspace
            </small>
          </div>

          <div className="form-group">
            <label htmlFor="git-branch">
              Git Branch <span className="optional">(optional)</span>
            </label>
            <input
              id="git-branch"
              type="text"
              placeholder={`Default: ${generateBranchName()}`}
              value={formData.gitBranch}
              onChange={(e) => handleChange("gitBranch", e.target.value)}
              disabled={loading}
            />
            <small className="form-help">
              Leave empty to auto-generate a unique branch name
            </small>
          </div>

          <div className="form-group">
            <label htmlFor="dockerfile-path">
              Dockerfile Path <span className="optional">(optional)</span>
            </label>
            <input
              id="dockerfile-path"
              type="text"
              placeholder="Dockerfile"
              value={formData.dockerfilePath}
              onChange={(e) => handleChange("dockerfilePath", e.target.value)}
              disabled={loading}
            />
            <small className="form-help">
              Path to custom Dockerfile (defaults to standard service image)
            </small>
          </div>

          <div className="form-group">
            <label htmlFor="env-vars">
              Environment Variables <span className="optional">(optional)</span>
            </label>
            <textarea
              id="env-vars"
              placeholder='{"API_KEY": "value", "DEBUG": "true"}'
              value={formData.customEnvVars}
              onChange={(e) => handleChange("customEnvVars", e.target.value)}
              disabled={loading}
              rows={4}
            />
            <small className="form-help">
              JSON object with environment variables for the service
            </small>
          </div>

          {error && (
            <div className="form-error" role="alert">
              {error}
            </div>
          )}

          <div className="modal-actions">
            <button
              type="button"
              className="ghost-button"
              onClick={handleClose}
              disabled={loading}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="primary-button"
              disabled={loading}
            >
              {loading ? "Creating..." : "Create Session"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default NewSessionModal;
