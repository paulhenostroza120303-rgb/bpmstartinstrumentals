FROM node:20-slim

RUN apt-get update && \
    apt-get install -y curl ffmpeg unzip && \
    rm -rf /var/lib/apt/lists/*

RUN curl -fsSL https://deno.land/install.sh | sh && \
    mv /root/.deno/bin/deno /usr/local/bin/deno

RUN curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp \
    -o /usr/local/bin/yt-dlp && \
    chmod +x /usr/local/bin/yt-dlp

WORKDIR /app

COPY local-helper/package*.json ./
RUN npm install --production

COPY local-helper/server.js .

RUN mkdir -p temp

EXPOSE 3000

CMD ["node", "server.js"]
