import database from "../db";
import type { SessionSettingsRecord } from "../types/database";

/**
 * Git Branch Manager Service
 * Handles branch creation, validation, synchronization, and cleanup for sessions.
 */

export type BranchValidationResult = {
  valid: boolean;
  error?: string;
  conflictingSessionId?: string;
};

export type BranchCreationResult = {
  success: boolean;
  branchName: string;
  error?: string;
};

/**
 * Generates a branch name for a session.
 * If user provides a custom branch, use it. Otherwise, generate session/<sessionId>.
 */
export function generateSessionBranchName(
  sessionId: string,
  customBranch?: string | null,
): string {
  if (customBranch) {
    return customBranch;
  }
  return `session/${sessionId}`;
}

/**
 * Checks if a branch is already in use by another session.
 * Returns validation result with conflict details if found.
 */
export async function checkBranchUniqueness(
  gitRemoteUrl: string,
  gitBranch: string,
  excludeSessionId?: string,
): Promise<BranchValidationResult> {
  try {
    // Query database for existing sessions using this repo + branch combination
    const existingSessions = database
      .listSessions("")  // Get all sessions (we'll filter by repo/branch)
      .filter((session) => {
        if (excludeSessionId && session.id === excludeSessionId) {
          return false; // Exclude the current session from conflict check
        }
        const settings = database.getSessionSettings(session.id);
        if (!settings) return false;

        return (
          settings.gitRemoteUrl === gitRemoteUrl &&
          settings.gitBranch === gitBranch
        );
      });

    if (existingSessions.length > 0) {
      return {
        valid: false,
        error: `Branch "${gitBranch}" is already in use by session "${existingSessions[0].title}"`,
        conflictingSessionId: existingSessions[0].id,
      };
    }

    return { valid: true };
  } catch (error) {
    console.error("Error checking branch uniqueness:", error);
    return {
      valid: false,
      error: error instanceof Error ? error.message : "Failed to check branch uniqueness",
    };
  }
}

/**
 * Creates or validates a branch for a session.
 * - If customBranch provided: validates uniqueness
 * - If no customBranch: generates session/<sessionId>
 * Returns the branch name to use.
 */
export async function ensureBranchForSession(
  sessionId: string,
  userId: string,
  settings: {
    gitRemoteUrl?: string | null;
    gitBranch?: string | null;
  },
): Promise<BranchCreationResult> {
  try {
    // If no Git remote URL, no branch needed
    if (!settings.gitRemoteUrl) {
      return {
        success: true,
        branchName: "",
      };
    }

    // Determine branch name
    const branchName = generateSessionBranchName(sessionId, settings.gitBranch);

    // Check uniqueness if using custom branch
    if (settings.gitBranch) {
      const validation = await checkBranchUniqueness(
        settings.gitRemoteUrl,
        branchName,
        sessionId,
      );

      if (!validation.valid) {
        return {
          success: false,
          branchName,
          error: validation.error,
        };
      }
    }

    // For auto-generated branches (session/<id>), create on GitHub
    if (!settings.gitBranch) {
      const token = database.getGitHubOAuthToken(userId);
      if (!token) {
        return {
          success: false,
          branchName,
          error: "GitHub not connected. Please connect GitHub first.",
        };
      }

      // Parse repo owner and name from URL
      const repoMatch = settings.gitRemoteUrl.match(
        /github\.com[/:]([^/]+)\/([^/.]+)/,
      );
      if (!repoMatch) {
        return {
          success: false,
          branchName,
          error: "Invalid GitHub repository URL",
        };
      }

      const [, owner, repo] = repoMatch;

      // Create branch on GitHub using API
      try {
        await createGitHubBranch(
          token.accessToken,
          owner,
          repo.replace(/\.git$/, ""),
          branchName,
        );
      } catch (error) {
        console.error("Failed to create GitHub branch:", error);
        return {
          success: false,
          branchName,
          error: error instanceof Error ? error.message : "Failed to create branch on GitHub",
        };
      }
    }

    return {
      success: true,
      branchName,
    };
  } catch (error) {
    console.error("Error ensuring branch for session:", error);
    return {
      success: false,
      branchName: settings.gitBranch || `session/${sessionId}`,
      error: error instanceof Error ? error.message : "Failed to create branch",
    };
  }
}

/**
 * Formats a repository name into a human-readable title.
 * Converts kebab-case, snake_case, or camelCase to Title Case.
 * Examples:
 * - "hello-world-typescript" -> "Hello World Typescript"
 * - "my_awesome_project" -> "My Awesome Project"
 * - "myProject" -> "My Project"
 */
function formatRepoTitle(repoName: string): string {
  return repoName
    // Replace hyphens and underscores with spaces
    .replace(/[-_]/g, " ")
    // Add space before capital letters (for camelCase)
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    // Capitalize first letter of each word
    .split(" ")
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

/**
 * Creates an initial commit on an empty repository.
 * Creates a README.md with the repository title.
 */
async function createInitialCommit(
  accessToken: string,
  owner: string,
  repo: string,
  defaultBranch: string,
): Promise<string> {
  // Format the repo name into a nice title
  const title = formatRepoTitle(repo);

  // Use the Contents API to create a README.md file
  const response = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/contents/README.md`,
    {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/vnd.github.v3+json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message: "Initial commit",
        content: Buffer.from(`# ${title}\n`).toString("base64"),
        branch: defaultBranch,
      }),
    },
  );

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`Failed to create initial commit:`, {
      status: response.status,
      statusText: response.statusText,
      body: errorText,
    });
    throw new Error(`Failed to create initial commit: ${response.status} ${errorText}`);
  }

  const data = (await response.json()) as {
    commit: { sha: string };
  };

  console.log(`Created initial commit on ${owner}/${repo} (${defaultBranch}): ${data.commit.sha}`);
  return data.commit.sha;
}

/**
 * Creates a new branch on GitHub from the default branch.
 */
async function createGitHubBranch(
  accessToken: string,
  owner: string,
  repo: string,
  branchName: string,
): Promise<void> {
  // Get the default branch's SHA
  const repoResponse = await fetch(
    `https://api.github.com/repos/${owner}/${repo}`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/vnd.github.v3+json",
      },
    },
  );

  if (!repoResponse.ok) {
    const errorBody = await repoResponse.text();
    console.error(`GitHub API error fetching repository ${owner}/${repo}:`, {
      status: repoResponse.status,
      statusText: repoResponse.statusText,
      body: errorBody,
    });

    if (repoResponse.status === 404) {
      throw new Error(`Repository not found: ${owner}/${repo}. Please verify the repository exists and you have access.`);
    }

    throw new Error(`Failed to fetch repository: ${repoResponse.status} ${repoResponse.statusText}`);
  }

  const repoData = (await repoResponse.json()) as {
    default_branch: string;
  };

  // Get the SHA of the default branch
  const refResponse = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/git/refs/heads/${repoData.default_branch}`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/vnd.github.v3+json",
      },
    },
  );

  let defaultBranchSha: string;

  if (!refResponse.ok) {
    const errorBody = await refResponse.text();
    console.error(`GitHub API error fetching ref for ${owner}/${repo}:`, {
      status: refResponse.status,
      statusText: refResponse.statusText,
      body: errorBody,
      defaultBranch: repoData.default_branch,
    });

    // Handle empty repository case - create initial commit
    if (refResponse.status === 409 || refResponse.status === 404) {
      console.log(`Repository ${owner}/${repo} appears empty, creating initial commit...`);
      try {
        defaultBranchSha = await createInitialCommit(
          accessToken,
          owner,
          repo,
          repoData.default_branch,
        );
      } catch (initError) {
        throw new Error(
          `Repository is empty and failed to create initial commit: ${initError instanceof Error ? initError.message : String(initError)}`
        );
      }
    } else {
      throw new Error(`Failed to fetch default branch: ${refResponse.status} ${refResponse.statusText}`);
    }
  } else {
    const refData = (await refResponse.json()) as {
      object: { sha: string };
    };
    defaultBranchSha = refData.object.sha;
  }

  // Create the new branch
  const createResponse = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/git/refs`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/vnd.github.v3+json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        ref: `refs/heads/${branchName}`,
        sha: defaultBranchSha,
      }),
    },
  );

  if (!createResponse.ok) {
    let errorMessage = createResponse.statusText;
    try {
      const errorData = await createResponse.json();
      errorMessage = errorData.message || errorMessage;
      console.error(`GitHub API error creating branch ${branchName}:`, {
        status: createResponse.status,
        statusText: createResponse.statusText,
        error: errorData,
      });
    } catch {
      // Response might not be JSON
      const errorText = await createResponse.text();
      console.error(`GitHub API error creating branch ${branchName}:`, {
        status: createResponse.status,
        statusText: createResponse.statusText,
        body: errorText,
      });
    }

    // Handle branch already exists case
    if (createResponse.status === 422) {
      throw new Error(`Branch '${branchName}' already exists on GitHub. ${errorMessage}`);
    }

    throw new Error(`Failed to create branch: ${errorMessage}`);
  }
}

/**
 * Pushes workspace changes to the session's Git branch.
 * This would typically:
 * 1. Stage all changes in the workspace
 * 2. Create a commit
 * 3. Push to the remote branch
 *
 * Note: This is a placeholder for future implementation.
 * Actual implementation would require:
 * - Git CLI access or a Git library (e.g., simple-git)
 * - Workspace file system access
 * - Handling Git credentials
 */
export async function pushWorkspaceToBranch(
  sessionId: string,
  userId: string,
  commitMessage?: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const settings = database.getSessionSettings(sessionId);
    if (!settings?.gitBranch || !settings?.gitRemoteUrl) {
      return {
        success: false,
        error: "Session does not have Git configuration",
      };
    }

    const token = database.getGitHubOAuthToken(userId);
    if (!token) {
      return {
        success: false,
        error: "GitHub not connected",
      };
    }

    // TODO: Implement actual Git operations
    // This would require:
    // 1. Access to the workspace directory
    // 2. Git CLI or library integration
    // 3. Staging, committing, and pushing changes

    console.warn("pushWorkspaceToBranch: Not yet implemented");

    return {
      success: false,
      error: "Git synchronization not yet implemented",
    };
  } catch (error) {
    console.error("Error pushing workspace to branch:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to push to branch",
    };
  }
}

/**
 * Deletes a session's branch from GitHub if it's an auto-generated branch.
 * User-created branches are NOT deleted.
 */
export async function deleteSessionBranch(
  sessionId: string,
  userId: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const settings = database.getSessionSettings(sessionId);
    if (!settings?.gitBranch || !settings?.gitRemoteUrl) {
      return { success: true }; // No branch to delete
    }

    // Only delete auto-generated session branches
    if (!settings.gitBranch.startsWith("session/")) {
      return { success: true }; // User branch, don't delete
    }

    const token = database.getGitHubOAuthToken(userId);
    if (!token) {
      return {
        success: false,
        error: "GitHub not connected",
      };
    }

    // Parse repo owner and name
    const repoMatch = settings.gitRemoteUrl.match(
      /github\.com[/:]([^/]+)\/([^/.]+)/,
    );
    if (!repoMatch) {
      return {
        success: false,
        error: "Invalid GitHub repository URL",
      };
    }

    const [, owner, repo] = repoMatch;

    // Delete branch via GitHub API
    const response = await fetch(
      `https://api.github.com/repos/${owner}/${repo.replace(/\.git$/, "")}/git/refs/heads/${settings.gitBranch}`,
      {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${token.accessToken}`,
          Accept: "application/vnd.github.v3+json",
        },
      },
    );

    if (!response.ok && response.status !== 404) {
      throw new Error(`Failed to delete branch: ${response.statusText}`);
    }

    return { success: true };
  } catch (error) {
    console.error("Error deleting session branch:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to delete branch",
    };
  }
}
