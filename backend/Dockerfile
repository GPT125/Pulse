FROM node:20-bookworm-slim

# Install yt-dlp + ffmpeg + python (yt-dlp dep) + ca-certs
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    ffmpeg \
    ca-certificates \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Install latest yt-dlp (more reliable than apt version)
RUN curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp \
    && chmod a+rx /usr/local/bin/yt-dlp

WORKDIR /app

COPY backend/package*.json ./backend/
WORKDIR /app/backend
RUN npm ci --omit=dev

COPY backend ./
COPY frontend ../frontend

# Persistent dirs
RUN mkdir -p data uploads/games uploads/avatars

ENV NODE_ENV=production
ENV PORT=4000
EXPOSE 4000

CMD ["node", "server.js"]
