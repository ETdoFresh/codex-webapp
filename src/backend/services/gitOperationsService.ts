import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import database from "../db";
import { getWorkspaceDirectory } from "../workspaces";

type GitHubTreeEntry = {
  path: string;
  mode: "100644" | "100755" | "040000" | "160000" | "120000";
  type: "blob" | "tree" | "commit";
  sha?: string;
  content?: string;
};

/**
 * Gets all tracked and modified files from git status
 */
function getGitFiles(workspacePath: string): string[] {
  try {
    // Get all tracked files that are modified, added, or deleted
    const output = execSync('git status --porcelain', {
      cwd: workspacePath,
      encoding: 'utf-8',
    });

    const files: string[] = [];
    const lines = output.split('\n').filter(line => line.trim());

    for (const line of lines) {
      // Git status format: XY filename
      // We want files that are not deleted (D in second column)
      const status = line.substring(0, 2);
      const filename = line.substring(3).trim();

      // Skip deleted files (they won't be in the working tree)
      if (status[1] !== 'D' && status[0] !== 'D') {
        files.push(filename);
      }
    }

    return files;
  } catch (error) {
    console.error('Error getting git files:', error);
    return [];
  }
}

/**
 * Commits and pushes changes to GitHub using the API
 */
export async function commitAndPushToGitHub(
  sessionId: string,
  userId: string,
  commitMessage: string,
): Promise<{ success: boolean; error?: string; commitSha?: string }> {
  try {
    const session = database.getSession(sessionId);
    if (!session) {
      return { success: false, error: 'Session not found' };
    }

    const settings = database.getSessionSettings(sessionId);
    if (!settings?.gitRemoteUrl || !settings?.gitBranch) {
      return { success: false, error: 'Session does not have Git configuration' };
    }

    const token = database.getGitHubOAuthToken(userId);
    if (!token) {
      return { success: false, error: 'GitHub not connected' };
    }

    // Parse repo owner and name from URL
    const repoMatch = settings.gitRemoteUrl.match(
      /github\.com[/:]([^/]+)\/([^/.]+)/,
    );
    if (!repoMatch) {
      return { success: false, error: 'Invalid GitHub repository URL' };
    }

    const [, owner, repo] = repoMatch;
    const repoName = repo.replace(/\.git$/, '');
    const branch = settings.gitBranch;

    const workspacePath = getWorkspaceDirectory(sessionId);

    // Stage all changes first
    try {
      execSync('git add -A', { cwd: workspacePath, stdio: 'pipe' });
    } catch (error) {
      console.error('Error staging files:', error);
      return { success: false, error: 'Failed to stage files' };
    }

    // Get the current branch ref
    const refResponse = await fetch(
      `https://api.github.com/repos/${owner}/${repoName}/git/refs/heads/${branch}`,
      {
        headers: {
          Authorization: `Bearer ${token.accessToken}`,
          Accept: 'application/vnd.github.v3+json',
        },
      },
    );

    if (!refResponse.ok) {
      const errorText = await refResponse.text();
      console.error('Failed to get branch ref:', errorText);
      return { success: false, error: `Failed to get branch: ${refResponse.status}` };
    }

    const refData = (await refResponse.json()) as {
      object: { sha: string; type: string };
    };
    const parentCommitSha = refData.object.sha;

    // Get the parent commit's tree
    const commitResponse = await fetch(
      `https://api.github.com/repos/${owner}/${repoName}/git/commits/${parentCommitSha}`,
      {
        headers: {
          Authorization: `Bearer ${token.accessToken}`,
          Accept: 'application/vnd.github.v3+json',
        },
      },
    );

    if (!commitResponse.ok) {
      return { success: false, error: 'Failed to get parent commit' };
    }

    const commitData = (await commitResponse.json()) as {
      tree: { sha: string };
    };
    const baseTreeSha = commitData.tree.sha;

    // Get all changed files
    const changedFiles = getGitFiles(workspacePath);
    if (changedFiles.length === 0) {
      return { success: false, error: 'No changes to commit' };
    }

    // Create blobs and tree entries for changed files
    const treeEntries: GitHubTreeEntry[] = [];
    const failedFiles: string[] = [];

    for (const file of changedFiles) {
      const filePath = path.join(workspacePath, file);

      if (!fs.existsSync(filePath)) {
        console.log(`[auto-commit] Skipping deleted file: ${file}`);
        continue; // File was deleted
      }

      const content = fs.readFileSync(filePath, 'utf-8');

      // Create blob
      const blobResponse = await fetch(
        `https://api.github.com/repos/${owner}/${repoName}/git/blobs`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token.accessToken}`,
            Accept: 'application/vnd.github.v3+json',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            content: content,
            encoding: 'utf-8',
          }),
        },
      );

      if (!blobResponse.ok) {
        const errorText = await blobResponse.text();
        console.error(`[auto-commit] Failed to create blob for ${file}:`, {
          status: blobResponse.status,
          statusText: blobResponse.statusText,
          error: errorText,
        });
        failedFiles.push(file);
        continue;
      }

      const blobData = (await blobResponse.json()) as { sha: string };

      treeEntries.push({
        path: file.replace(/\\/g, '/'), // Normalize path separators
        mode: '100644',
        type: 'blob',
        sha: blobData.sha,
      });
    }

    if (treeEntries.length === 0) {
      console.error(`[auto-commit] No blobs created. Failed files:`, failedFiles);
      return { success: false, error: `Failed to create blobs for files: ${failedFiles.join(', ')}` };
    }

    if (failedFiles.length > 0) {
      console.warn(`[auto-commit] Some files failed to create blobs:`, failedFiles);
    }

    console.log(`[auto-commit] Created ${treeEntries.length} blobs for commit`);

    // Create a new tree
    const treeResponse = await fetch(
      `https://api.github.com/repos/${owner}/${repoName}/git/trees`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token.accessToken}`,
          Accept: 'application/vnd.github.v3+json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          base_tree: baseTreeSha,
          tree: treeEntries,
        }),
      },
    );

    if (!treeResponse.ok) {
      const errorText = await treeResponse.text();
      console.error('Failed to create tree:', errorText);
      return { success: false, error: 'Failed to create tree' };
    }

    const treeData = (await treeResponse.json()) as { sha: string };

    // Create a commit
    const newCommitResponse = await fetch(
      `https://api.github.com/repos/${owner}/${repoName}/git/commits`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token.accessToken}`,
          Accept: 'application/vnd.github.v3+json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: commitMessage,
          tree: treeData.sha,
          parents: [parentCommitSha],
        }),
      },
    );

    if (!newCommitResponse.ok) {
      const errorText = await newCommitResponse.text();
      console.error('Failed to create commit:', errorText);
      return { success: false, error: 'Failed to create commit' };
    }

    const newCommitData = (await newCommitResponse.json()) as { sha: string };
    const newCommitSha = newCommitData.sha;

    // Update the branch reference
    const updateRefResponse = await fetch(
      `https://api.github.com/repos/${owner}/${repoName}/git/refs/heads/${branch}`,
      {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${token.accessToken}`,
          Accept: 'application/vnd.github.v3+json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          sha: newCommitSha,
          force: false,
        }),
      },
    );

    if (!updateRefResponse.ok) {
      const errorText = await updateRefResponse.text();
      console.error('Failed to update branch:', errorText);
      return { success: false, error: 'Failed to push commit' };
    }

    console.log(`Successfully committed and pushed to ${owner}/${repoName}:${branch} - ${newCommitSha}`);
    return { success: true, commitSha: newCommitSha };
  } catch (error) {
    console.error('Error committing and pushing to GitHub:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
