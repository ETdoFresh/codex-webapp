FROM node:20-slim

# Install basic tools
RUN apt-get update && apt-get install -y \
    git \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Set up /editor directory for the container app
WORKDIR /editor

# Copy package files
COPY package*.json ./

# Install ALL dependencies (including dev dependencies for build)
RUN npm ci

# Copy source code
COPY . .

# Build the application
RUN npm run build

# Remove dev dependencies to reduce image size
RUN npm ci --production

# Create workspace directory for user's cloned repo
RUN mkdir -p /workspace

# Make init script executable
RUN chmod +x /editor/scripts/container-init.sh

# Expose port for container app
EXPOSE 3001

# Set environment
ENV NODE_ENV=production
ENV PORT=3001
ENV WORKSPACE_PATH=/workspace

# Start with init script (clones repo) then start app
CMD ["/bin/bash", "-c", "/editor/scripts/container-init.sh && node /editor/dist/server/index.js"]
