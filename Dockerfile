FROM node:20-slim

WORKDIR /app

COPY local-helper/package*.json ./
RUN npm install --production

COPY local-helper/server.js .

RUN mkdir -p temp

EXPOSE 3000

CMD ["node", "server.js"]
