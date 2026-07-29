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
    && groupadd --system --gid 1001 athr \
    && useradd --system --uid 1001 --gid athr --home-dir /app athr

COPY --from=build --chown=athr:athr /app/package.json /app/package-lock.json ./
COPY --from=build --chown=athr:athr /app/node_modules ./node_modules
COPY --from=build --chown=athr:athr /app/dist ./dist
COPY --from=build --chown=athr:athr /app/prisma ./prisma

USER athr
EXPOSE 3000

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/src/main.js"]
