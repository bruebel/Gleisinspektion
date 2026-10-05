# Baukontext ist das Wurzelverzeichnis des Repositorys (wegen package-lock.json der Workspaces).
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY api/package.json api/
COPY web/package.json web/
RUN npm ci -w web --include-workspace-root=false
COPY web web
RUN npm run build -w web

# Liefert nur die fertigen Dateien aus; HTTPS übernimmt der gemeinsame Caddy (deploy/proxy).
FROM caddy:2-alpine
COPY web/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/web/dist /srv
EXPOSE 80
