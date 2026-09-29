# syntax=docker/dockerfile:1
# ==============================================================================
# CRM Sales Novacore - production image
# ==============================================================================
# Designed for Coolify's "Dockerfile" build pack, which builds in this repo and
# runs the resulting image behind its proxy.
#
# Three stages, so the runtime image carries neither the build toolchain nor the
# dev dependencies. Final image lands around 200-250 MB rather than ~900 MB.
# ==============================================================================


# --- Stage 1: install dependencies -------------------------------------------
FROM node:20-alpine AS deps
WORKDIR /app

# Copy manifests only, so a source-only change reuses the cached npm layer.
COPY package.json package-lock.json* ./

# `npm ci` when a lockfile exists (reproducible), otherwise fall back to install.
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi


# --- Stage 2: build ----------------------------------------------------------
FROM node:20-alpine AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Next.js reads AUTH_* vars at build time for route prerendering. The values
# here are placeholders: the real ones are injected at runtime by Coolify. If
# they are absent the build fails, so give it something inert.
ENV NEXT_TELEMETRY_DISABLED=1
ENV AUTH_SECRET=build-time-placeholder-not-used-at-runtime
ENV AUTH_TRUST_HOST=true
ENV AUTH_GOOGLE_ID=build-time-placeholder
ENV AUTH_GOOGLE_SECRET=build-time-placeholder

# `output: 'standalone'` (see next.config.ts) produces .next/standalone with a
# self-contained server and a pruned node_modules.
RUN npm run build


# --- Stage 3: runtime --------------------------------------------------------
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Run unprivileged. The node image already ships a `node` user (uid 1000).
RUN addgroup --system --gid 1001 nodejs \
 && adduser  --system --uid 1001 nextjs

# `pg` is a runtime dependency (it has native bindings in some environments).
# npm ci --omit=dev in the runner keeps it without pulling the whole tree from
# the builder.
COPY package.json package-lock.json* ./
RUN if [ -f package-lock.json ]; then npm ci --omit=dev; else npm install --omit=dev; fi

# Standalone output: server.js plus the minimal node_modules it requires.
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

USER nextjs
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/auth/session').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
