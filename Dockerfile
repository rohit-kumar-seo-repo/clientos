# syntax=docker/dockerfile:1

# Matches the Node major version this app is developed and tested against
# locally, to eliminate "works on my machine, not in the container" drift.
ARG NODE_VERSION=26

# ---------------------------------------------------------------------------
# deps — install once, cached separately from source changes
# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION}-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ---------------------------------------------------------------------------
# builder — generate the Prisma client, then build Next.js
# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION}-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# DATABASE_URL is only needed by `prisma generate` to read the schema's
# datasource block shape, not to connect — no real value required at build
# time, and no secret is baked into the image.
ENV DATABASE_URL="mysql://build:build@localhost:3306/build"
RUN npx prisma generate
RUN npm run build

# ---------------------------------------------------------------------------
# runner — minimal runtime image, non-root, only the standalone output
# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION}-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
# Migrations + Prisma CLI are needed at container start to run
# `prisma migrate deploy` before the server starts serving traffic.
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/prisma7.config.ts ./prisma7.config.ts
COPY --from=builder /app/node_modules/.bin/prisma ./node_modules/.bin/prisma
COPY --from=builder /app/node_modules/prisma ./node_modules/prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=builder /app/node_modules/dotenv ./node_modules/dotenv
COPY docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x ./docker-entrypoint.sh

USER nextjs
EXPOSE 3000
ENV PORT=3000
ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["node", "server.js"]
