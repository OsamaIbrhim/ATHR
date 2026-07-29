FROM node:20.19-bookworm-slim AS dependencies
WORKDIR /app
ENV CI=true
COPY package.json package-lock.json ./
RUN npm ci

FROM node:20.19-bookworm-slim AS build
WORKDIR /app
ARG ATHR_API_INTERNAL_BASE
ENV ATHR_API_INTERNAL_BASE=${ATHR_API_INTERNAL_BASE}
COPY --from=dependencies /app/node_modules ./node_modules
COPY . .
RUN mkdir -p public && npm run build

FROM node:20.19-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3001 \
    HOSTNAME=0.0.0.0
RUN groupadd --system --gid 1001 nodejs \
    && useradd --system --uid 1001 --gid nodejs --home-dir /app nextjs
COPY --from=build --chown=nextjs:nodejs /app/public ./public
COPY --from=build --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=build --chown=nextjs:nodejs /app/.next/static ./.next/static
USER nextjs
EXPOSE 3001
CMD ["node", "server.js"]
