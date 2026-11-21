FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci --include=dev
COPY . .
RUN npm run build:node

FROM node:22-bookworm-slim
ENV NODE_ENV=production PORT=3000 ROOM_DB_PATH=/data/rooms.sqlite
WORKDIR /app
COPY --from=build /app/dist/client ./dist/client
COPY --from=build /app/server ./server
COPY --from=build /app/src/engine.js ./src/engine.js
COPY --from=build /app/drizzle ./drizzle
COPY package.json ./
RUN mkdir /data && chown node:node /data
USER node
EXPOSE 3000
CMD ["node", "server/node.js"]
