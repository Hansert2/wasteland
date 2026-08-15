# A plain Node process. No build step, no bundler, nothing to compile — the image is
# the source plus production dependencies, and that is the whole story.
#
# Deliberately host-agnostic: this runs unchanged on Fly, Render, Railway or any box
# with a container runtime. Only fly.toml beside it is Fly-specific, and it is small.
FROM node:22-alpine

# Postgres client libraries are not needed — `pg` speaks the wire protocol itself.
WORKDIR /app

# Dependencies first, so a source change does not re-resolve the whole tree.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY src ./src
COPY migrations ./migrations

# Never root. The app writes nothing to disk — every piece of state is in Postgres —
# so it does not even need a writable working directory.
USER node

ENV NODE_ENV=production
EXPOSE 3000

# Directly, not through npm. The npm scripts wrap `scripts/with-db.mjs`, which brings
# up a local WSL Docker container for development and is meaningless in here.
CMD ["node", "src/server.js"]
