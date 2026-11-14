# syntax=docker/dockerfile:1.7

# ---- build the glasses web app ---------------------------------------------
FROM node:24-bookworm-slim AS app-build
# The app's devDependencies include Playwright for the local test gate; no browsers here.
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
WORKDIR /app
COPY app/package.json app/package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund
COPY app/ ./
RUN npm run build

# ---- runtime: Node server (static app + API) --------------------------------
FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production \
    PORT=8787 \
    PUBLIC_DIR=/srv/public
WORKDIR /srv

RUN groupadd --system --gid 1001 app \
 && useradd  --system --uid 1001 --gid app app

COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY --chown=app:app server/ ./
COPY --from=app-build --chown=app:app /app/dist ./public

USER app
EXPOSE 8787

HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/up').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
