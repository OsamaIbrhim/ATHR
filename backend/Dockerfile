FROM node:20.19-bookworm-slim AS dependencies
WORKDIR /app
ENV CI=true

RUN apt-get update \
    && apt-get install --no-install-recommends -y ca-certificates openssl \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci

FROM dependencies AS build
COPY . .
RUN npm run build

FROM node:20.19-bookworm-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    PORT=3000

RUN apt-get update \
    && apt-get install --no-install-recommends -y ca-certificates dumb-init openssl \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --system --gid 1001 bold \
    && useradd --system --uid 1001 --gid bold --home-dir /app bold

COPY --from=build --chown=bold:bold /app/package.json /app/package-lock.json ./
COPY --from=build --chown=bold:bold /app/node_modules ./node_modules
COPY --from=build --chown=bold:bold /app/dist ./dist
COPY --from=build --chown=bold:bold /app/prisma ./prisma

USER bold
EXPOSE 3000

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/src/main.js"]