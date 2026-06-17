FROM node:18-alpine

WORKDIR /app

RUN apk add --no-cache python3 make g++

COPY server/package.json server/package-lock.json ./server/
RUN cd server && npm ci --production

COPY server/ ./server/
COPY client/ ./client/

RUN mkdir -p /app/data
VOLUME ["/app/data"]

EXPOSE 3000

WORKDIR /app/server
CMD ["node", "server.js"]
