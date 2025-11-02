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
  url?: string;
};

type GitHubTreeResponse = {
  sha: string;
  url: string;
  tree: GitHubTreeEntry[];
  truncated: boolean;
};

/**
 * Recursively gets all files in a directory, excluding certain patterns
 */
function getAllFilesInDirectory(dirPath: string, baseDir: string = dirPath): string[] {
  const files: string[] = [];

  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      const relativePath = path.relative(baseDir, fullPath);

      // Skip hidden files/directories and common ignore patterns
      if (entry.name.startsWith('.')) {
        continue;
      }
      if (entry.name === 'node_modules' || entry.name === '__pycache__') {
        continue;
      }

      if (entry.isDirectory()) {
        files.push(...getAllFilesInDirectory(fullPath, baseDir));
      } else if (entry.isFile()) {
        files.push(relativePath);
      }
    }
  } catch (error) {
    console.error(`Error reading directory ${dirPath}:`, error);
  }

  return files;
}

/**
 * Clones repository contents into the workspace
 */
export async function cloneRepositoryToWorkspace(
  sessionId: string,
  userId: string,
): Promise<{ success: boolean; error?: string; filesCloned?: number }> {
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

    console.log(`[clone-repo] Cloning ${owner}/${repoName}:${branch} to workspace ${sessionId}`);

    // Get the branch ref to get the commit SHA
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
      console.error('[clone-repo] Failed to get branch ref:', errorText);
      return { success: false, error: `Failed to get branch: ${refResponse.status}` };
    }

    const refData = (await refResponse.json()) as {
      object: { sha: string };
    };
    const commitSha = refData.object.sha;

    // Get the tree for this commit (recursive to get all files)
    const treeResponse = await fetch(
      `https://api.github.com/repos/${owner}/${repoName}/git/trees/${commitSha}?recursive=1`,
      {
        headers: {
          Authorization: `Bearer ${token.accessToken}`,
          Accept: 'application/vnd.github.v3+json',
        },
      },
    );

    if (!treeResponse.ok) {
      const errorText = await treeResponse.text();
      console.error('[clone-repo] Failed to get tree:', errorText);
      return { success: false, error: 'Failed to get repository tree' };
    }

    const treeData = (await treeResponse.json()) as GitHubTreeResponse;

    const workspacePath = getWorkspaceDirectory(sessionId);

    // Download all blobs and write to workspace
    let filesCloned = 0;
    for (const item of treeData.tree) {
      // Only process blobs (files), not trees (directories)
      if (item.type !== 'blob') {
        continue;
      }

      // Get the blob content
      const blobResponse = await fetch(
        `https://api.github.com/repos/${owner}/${repoName}/git/blobs/${item.sha}`,
        {
          headers: {
            Authorization: `Bearer ${token.accessToken}`,
            Accept: 'application/vnd.github.v3+json',
          },
        },
      );

      if (!blobResponse.ok) {
        console.warn(`[clone-repo] Failed to get blob for ${item.path}, skipping`);
        continue;
      }

      const blobData = (await blobResponse.json()) as {
        content: string;
        encoding: string;
        sha: string;
      };

      // Decode the content (it's base64 encoded)
      const content = Buffer.from(blobData.content, 'base64').toString('utf-8');

      // Write to workspace
      const filePath = path.join(workspacePath, item.path);
      const fileDir = path.dirname(filePath);

      // Ensure directory exists
      if (!fs.existsSync(fileDir)) {
        fs.mkdirSync(fileDir, { recursive: true });
      }

      fs.writeFileSync(filePath, content, 'utf-8');
      filesCloned++;
    }

    console.log(`[clone-repo] Successfully cloned ${filesCloned} files to workspace`);
    return { success: true, filesCloned };
  } catch (error) {
    console.error('Error cloning repository to workspace:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
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

    // Fetch the base tree to detect deletions
    const baseTreeResponse = await fetch(
      `https://api.github.com/repos/${owner}/${repoName}/git/trees/${baseTreeSha}?recursive=1`,
      {
        headers: {
          Authorization: `Bearer ${token.accessToken}`,
          Accept: 'application/vnd.github.v3+json',
        },
      },
    );

    if (!baseTreeResponse.ok) {
      return { success: false, error: 'Failed to get base tree' };
    }

    const baseTreeData = (await baseTreeResponse.json()) as {
      tree: Array<{ path: string; type: string; sha: string; mode: string }>;
    };

    // Get all files in workspace
    const workspaceFiles = new Set(getAllFilesInDirectory(workspacePath));
    console.log(`[auto-commit] Found ${workspaceFiles.size} files in workspace`);

    // Track files in base tree
    const baseTreeFiles = new Set(
      baseTreeData.tree
        .filter((entry) => entry.type === 'blob')
        .map((entry) => entry.path)
    );

    // Create blobs and tree entries for all workspace files
    const treeEntries: GitHubTreeEntry[] = [];
    const failedFiles: string[] = [];

    for (const file of workspaceFiles) {
      const filePath = path.join(workspacePath, file);
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

    // Detect and mark deleted files
    const deletedFiles: string[] = [];
    for (const baseFile of baseTreeFiles) {
      if (!workspaceFiles.has(baseFile)) {
        deletedFiles.push(baseFile);
        treeEntries.push({
          path: baseFile.replace(/\\/g, '/'),
          mode: '100644',
          type: 'blob',
          sha: null as any, // null sha marks file for deletion
        });
      }
    }

    if (deletedFiles.length > 0) {
      console.log(`[auto-commit] Detected ${deletedFiles.length} deleted files:`, deletedFiles);
    }

    if (treeEntries.length === 0) {
      console.error(`[auto-commit] No blobs created. Failed files:`, failedFiles);
      return { success: false, error: `Failed to create blobs for files: ${failedFiles.join(', ')}` };
    }

    if (failedFiles.length > 0) {
      console.warn(`[auto-commit] Some files failed to create blobs:`, failedFiles);
    }

    console.log(`[auto-commit] Created ${treeEntries.length} tree entries for commit`);

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
