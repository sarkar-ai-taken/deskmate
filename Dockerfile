FROM node:20-slim

# Install imagemagick for fallback screenshot support
RUN apt-get update && apt-get install -y --no-install-recommends \
    imagemagick \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install dependencies
COPY package.json package-lock.json ./
RUN npm ci --production

# Copy built output and assets
COPY dist/ dist/
COPY src/cli/tray-mac.swift src/cli/tray-mac.swift
COPY .env.example .env.example

ENV INSTALL_MODE=container

# Socket mount for sidecar communication
VOLUME /var/run/deskmate

# Host filesystem bind mount
VOLUME /hostfs

ENTRYPOINT ["node", "dist/cli.js"]
CMD ["gateway", "--no-tray"]
