# Etapa 1: compilar la PWA
FROM node:22-alpine AS web
WORKDIR /web
COPY mvp/web/package*.json ./
RUN npm ci
COPY mvp/web/ ./
RUN npm run build

# Etapa 2: API
FROM node:22-alpine
WORKDIR /app/api
COPY mvp/api/package*.json ./
RUN npm ci --omit=dev
COPY mvp/api/ ./
COPY --from=web /web/dist /app/web/dist
ENV WEB_DIST=/app/web/dist KEY_DIR=/app/keys NODE_ENV=production
EXPOSE 3000
CMD ["sh","-c","node src/seed.js && node src/server.js"]