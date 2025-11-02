FROM node:20-slim

WORKDIR /app

# Install basic tools
RUN apt-get update && apt-get install -y \
    git \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Copy package files
COPY package*.json ./
RUN npm ci --production

# Copy built application
COPY dist ./dist

# Create workspace directory
RUN mkdir -p /workspace

# Copy and set up initialization script
COPY scripts/container-init.sh /app/init.sh
RUN chmod +x /app/init.sh

# Expose port
EXPOSE 3001

# Set environment
ENV NODE_ENV=production
ENV PORT=3001

# Start with init script
CMD ["/bin/bash", "-c", "/app/init.sh && node /app/dist/server/index.js"]
