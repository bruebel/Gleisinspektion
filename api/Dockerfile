# Baukontext ist das Wurzelverzeichnis des Repositorys (wegen package-lock.json der Workspaces).
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY api/package.json api/
COPY web/package.json web/
RUN npm ci -w api --include-workspace-root=false
COPY api api
RUN npm run build -w api && npm prune --omit=dev -w api

FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/node_modules node_modules
COPY --from=build /app/api/package.json api/
COPY --from=build /app/api/dist api/dist
COPY --from=build /app/api/drizzle api/drizzle
# Ablage für Fotos (als Docker-Volume eingebunden), muss dem Benutzer node gehören.
RUN mkdir -p /daten/fotos && chown node:node /daten/fotos
ENV FOTO_ORDNER=/daten/fotos
USER node
WORKDIR /app/api
EXPOSE 3000
CMD ["node", "dist/index.js"]
