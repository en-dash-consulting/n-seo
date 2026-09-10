# n-seo — the engine as a container.
#
# The image is the engine only. All state (config, queue, content, data) lives
# in the instance directory mounted at /instance, so upgrading is "pull a new
# image" and nothing of yours is inside it.
#
#   docker build -t n-seo:latest .
#   docker volume create n-seo-instance
#   docker run --rm -v n-seo-instance:/instance n-seo:latest init
#   docker run -d -p 127.0.0.1:4600:4600 -v n-seo-instance:/instance n-seo:latest
#
# The dashboard writes config, and config sets the command the daily run
# executes. Never publish it on a public interface without auth in front —
# see docker/README.md and docker/compose.caddy.yml.

# ---- dependencies -----------------------------------------------------------
FROM node:22-bookworm-slim AS deps
WORKDIR /engine
COPY package.json package-lock.json ./
# --omit=dev keeps typescript and @types out; tsx is a runtime dependency
# because the engine runs TypeScript directly, with no build step.
RUN npm ci --omit=dev && npm cache clean --force

# ---- runtime ----------------------------------------------------------------
FROM node:22-bookworm-slim

# python3: the whole ingest/ops pipeline, stdlib only — no pip installs.
# curl: every HTTP call. (The service-account JWT used to need the openssl
# binary too; it is signed with node's crypto module now, so the image no
# longer carries openssl for it.)
# tini: reaps zombies and forwards signals to the long-running dashboard.
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      python3 curl ca-certificates tini \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /engine
COPY --from=deps /engine/node_modules ./node_modules
COPY --chown=root:root . .

# The instance is the only writable state. Owned by the unprivileged `node`
# user (uid 1000) so a named or anonymous volume inherits that ownership.
RUN mkdir -p /instance && chown node:node /instance
VOLUME ["/instance"]

ENV N_SEO_INSTANCE=/instance \
    NODE_ENV=production \
    PYTHON=python3
EXPOSE 4600
USER node

# Only meaningful for `serve`; compose disables it on the scheduler.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS "http://127.0.0.1:${SEO_PORT:-4600}/api/actions" >/dev/null || exit 1

ENTRYPOINT ["/usr/bin/tini", "--", "/engine/docker/entrypoint.sh"]
CMD ["serve"]
