FROM node:20.19-bookworm-slim AS dependencies
WORKDIR /app
ENV CI=true

RUN apt-get update \
    && apt-get install --no-install-recommends -y ca-certificates openssl \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json tsconfig.base.json ./
COPY backend/package.json ./backend/package.json
COPY admin-web/package.json ./admin-web/package.json
COPY pos-electron/package.json ./pos-electron/package.json
COPY packages/contracts/package.json ./packages/contracts/package.json
COPY packages/domain-core/package.json ./packages/domain-core/package.json
COPY packages/error-registry/package.json ./packages/error-registry/package.json
COPY packages/testing/package.json ./packages/testing/package.json
RUN npm ci --workspace athr-operations-api --include-workspace-root=false --install-strategy=nested

FROM dependencies AS build
COPY packages ./packages
RUN npm run build:shared
COPY backend ./backend
RUN npm run build --workspace athr-operations-api

FROM node:20.19-bookworm-slim AS runtime
WORKDIR /app/backend

ENV NODE_ENV=production \
    PORT=3000

RUN apt-get update \
    && apt-get install --no-install-recommends -y ca-certificates dumb-init openssl \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --system --gid 1001 athr \
    && useradd --system --uid 1001 --gid athr --home-dir /app athr

COPY --from=build --chown=athr:athr /app/package.json /app/package-lock.json /app/
COPY --from=build --chown=athr:athr /app/node_modules/@athr /app/node_modules/@athr
COPY --from=build --chown=athr:athr /app/packages/contracts/package.json /app/packages/contracts/package.json
COPY --from=build --chown=athr:athr /app/packages/contracts/dist /app/packages/contracts/dist
COPY --from=build --chown=athr:athr /app/packages/error-registry/package.json /app/packages/error-registry/package.json
COPY --from=build --chown=athr:athr /app/packages/error-registry/dist /app/packages/error-registry/dist
COPY --from=build --chown=athr:athr /app/backend/package.json ./package.json
COPY --from=build --chown=athr:athr /app/backend/node_modules ./node_modules
COPY --from=build --chown=athr:athr /app/backend/dist ./dist
COPY --from=build --chown=athr:athr /app/backend/prisma ./prisma
COPY --from=build --chown=athr:athr /app/backend/scripts ./scripts

USER athr
EXPOSE 3000

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/src/main.js"]
