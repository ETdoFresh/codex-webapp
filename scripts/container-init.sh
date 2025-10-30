#!/bin/bash
# Container initialization script
# Decodes auth files from environment variables and sets up the container

set -e

echo "[container-init] Starting container initialization..."

# Set HOME to /root for auth files
export HOME=/root

# Decode auth files from environment variables
echo "[container-init] Decoding auth files from environment variables..."

for var in $(env | grep '^AUTH_FILE_' | cut -d= -f1); do
    # Skip if it's a _DIR or _NAME variable
    if [[ $var == *"_DIR" ]] || [[ $var == *"_NAME" ]]; then
        continue
    fi

    # Get the base64-encoded content
    content=$(printenv "$var")

    # Get the directory and filename
    dir_var="${var}_DIR"
    name_var="${var}_NAME"

    dir=$(printenv "$dir_var")
    filename=$(printenv "$name_var")

    if [ -z "$dir" ] || [ -z "$filename" ]; then
        echo "[container-init] Warning: Missing directory or filename for $var"
        continue
    fi

    # Create the directory
    auth_dir="$HOME/$dir"
    mkdir -p "$auth_dir"
    chmod 700 "$auth_dir"

    # Decode and write the file
    filepath="$auth_dir/$filename"
    echo "$content" | base64 -d > "$filepath"
    chmod 600 "$filepath"

    echo "[container-init] Decoded $filepath"
done

# Clone GitHub repository if specified
if [ -n "$GITHUB_REPO" ]; then
    echo "[container-init] Cloning repository: $GITHUB_REPO"
    cd /workspace
    git clone "$GITHUB_REPO" . || {
        echo "[container-init] Warning: Failed to clone repository"
    }
fi

# Ensure workspace directory exists
mkdir -p /workspace
chmod 755 /workspace

# Ensure data directory exists
mkdir -p /data
chmod 755 /data

echo "[container-init] Container initialization complete"
echo "[container-init] Session ID: ${SESSION_ID:-unknown}"
echo "[container-init] Workspace: /workspace"
echo "[container-init] Database: /data/container.db"
echo "[container-init] Starting application..."
