# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim AS deps
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci

FROM node:22-bookworm-slim AS builder
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production
# Build-time placeholders only (runtime secrets come from compose/env).
ENV DATABASE_URL="postgresql://tinda:tinda@postgres:5432/tinda?schema=public"
ENV SESSION_SECRET="docker-build-session-secret-placeholder-32chars"
# Public URL baked into metadata/robots/sitemap at build time (override via --build-arg).
ARG APP_URL=https://tindamarket.ru
ENV APP_URL=${APP_URL}
ENV SITE_URL=${APP_URL}
ENV BASE_URL=${APP_URL}
ENV NEXTAUTH_URL=${APP_URL}
ENV NEXT_PUBLIC_APP_URL=${APP_URL}
ENV SITE_NAME="ТИНДА Маркет"
ENV SITE_DESCRIPTION="Оптовый каталог напитков и продуктов для магазинов, кафе, ресторанов и мероприятий."
ENV STORAGE_DRIVER="local"
RUN npx prisma generate && npm run build

FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && groupadd --system --gid 1001 nodejs \
  && useradd --system --uid 1001 --gid nodejs nextjs

# Next.js standalone server bundle
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

# Prisma schema + CLI for migrate deploy in entrypoint
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/node_modules/prisma ./node_modules/prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=builder /app/package.json ./package.json

COPY deploy/docker/entrypoint.sh ./deploy/docker/entrypoint.sh

RUN chmod +x ./deploy/docker/entrypoint.sh \
  && mkdir -p /app/public/uploads/products \
  && chown -R nextjs:nodejs /app

USER nextjs
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["./deploy/docker/entrypoint.sh"]
CMD ["node", "server.js"]
