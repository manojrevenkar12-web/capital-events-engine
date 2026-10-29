# syntax=docker/dockerfile:1.7
# API image: built from the repository root (docker build -f apps/api/Dockerfile .)
FROM node:22.20.0-bookworm-slim AS build
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true
RUN corepack enable
WORKDIR /src
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/engine/package.json packages/engine/
COPY apps/api/package.json apps/api/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile --filter @cee/api...
COPY packages/engine packages/engine
COPY apps/api apps/api
RUN pnpm --filter @cee/engine build \
 && pnpm --filter @cee/api exec swc src -d dist --strip-leading-paths --copy-files \
 && pnpm --filter @cee/api deploy --prod --legacy /out

# distroless: no shell, no package manager, runs as uid 65532
FROM gcr.io/distroless/nodejs22-debian12:nonroot
ENV NODE_ENV=production NODE_OPTIONS=--enable-source-maps
WORKDIR /app
COPY --from=build /out/ ./
EXPOSE 3000
USER nonroot
# the migration job runs: dist/db/migrate-cli.js
CMD ["dist/main.js"]
