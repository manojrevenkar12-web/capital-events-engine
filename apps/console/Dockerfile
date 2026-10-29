# syntax=docker/dockerfile:1.7
# Console image: built from the repository root (docker build -f apps/console/Dockerfile .)
FROM node:22.20.0-bookworm-slim AS build
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true
RUN corepack enable
WORKDIR /src
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/console/package.json apps/console/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile --filter @cee/console...
COPY apps/console apps/console
RUN pnpm --filter @cee/console exec vite build

FROM nginxinc/nginx-unprivileged:1.29-alpine
COPY apps/console/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /src/apps/console/dist /usr/share/nginx/html
EXPOSE 8080
