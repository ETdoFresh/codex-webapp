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
RUN npm ci --production

# Copy built application
COPY dist ./dist

# Create workspace directory for user's cloned repo
RUN mkdir -p /workspace

# Copy and set up initialization script
COPY scripts/container-init.sh /editor/init.sh
RUN chmod +x /editor/init.sh

# Expose port for container app
EXPOSE 3001

# Set environment
ENV NODE_ENV=production
ENV PORT=3001
ENV WORKSPACE_PATH=/workspace

# Start with init script (clones repo) then start app
CMD ["/bin/bash", "-c", "/editor/init.sh && node /editor/dist/server/index.js"]
