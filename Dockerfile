FROM node:24-alpine3.20 AS base
RUN apk add --no-cache dumb-init wget && corepack enable
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN pnpm build

# Imagem separada para migracao. A release nao serve: tsx e devDependency e
# scripts/ nao e copiado para la. Embutir o compilador na imagem de producao
# para rodar migracao anularia o proposito do multi-stage - por isso um alvo
# proprio, que so o initContainer do Kubernetes usa.
FROM deps AS migrator
ENV NODE_ENV=production
COPY tsconfig.json ./
COPY src ./src
COPY scripts ./scripts
COPY db ./db
USER node
ENTRYPOINT ["dumb-init", "--"]
CMD ["./node_modules/.bin/tsx", "scripts/migrate.ts"]

FROM base AS prod-deps
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --prod

FROM base AS release
ENV NODE_ENV=production PORT=3000
WORKDIR /app

COPY --chown=node:node --from=prod-deps /app/node_modules ./node_modules
COPY --chown=node:node --from=build /app/dist ./dist
COPY --chown=node:node package.json ./

USER node
EXPOSE 3000

HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/health/live >/dev/null 2>&1 || exit 1

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "--enable-source-maps", "dist/server.js"]