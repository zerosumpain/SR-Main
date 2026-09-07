FROM node:22.23.2-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends git rsync docker.io python3 ca-certificates \
    && rm -rf /var/lib/apt/lists/*
