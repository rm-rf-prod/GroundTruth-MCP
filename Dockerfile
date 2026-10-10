FROM node:26-alpine AS builder
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml postinstall.mjs ./
# pnpm version comes from packageManager in package.json (shared stack).
RUN npm install -g "$(node -p "require('./package.json').packageManager")" && pnpm install --frozen-lockfile
COPY . .
RUN pnpm run build

# Production node_modules only. pnpm, its store and the npm cache stay in this stage.
# --ignore-scripts: no runtime dependency needs one, and postinstall only writes root's install key.
FROM node:26-alpine AS deps
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN npm install -g "$(node -p "require('./package.json').packageManager")" && pnpm install --frozen-lockfile --prod --ignore-scripts

FROM node:26-alpine
ENV NODE_ENV=production
# The cache dir is created owned by gt so it does not depend on the umask at build or run time.
RUN addgroup -S gt && adduser -S -G gt gt && install -d -o gt -g gt -m 0700 /home/gt/.gt-mcp-cache
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
# Build-context files keep the host's mode; on umask-027 hosts USER gt could not read package.json.
COPY --chmod=644 package.json ./
USER gt
EXPOSE 3100
# Containers must listen beyond loopback, so the image refuses to start without GT_AUTH_TOKEN.
ENV GT_HTTP_PORT=3100 GT_HTTP_HOST=0.0.0.0 GT_CACHE_DIR=/home/gt/.gt-mcp-cache
# Shell form so the token and port expand at run time; /health stays behind auth.
HEALTHCHECK CMD wget -qO- --header="Authorization: Bearer ${GT_AUTH_TOKEN}" "http://127.0.0.1:${GT_HTTP_PORT}/health" || exit 1
CMD ["node", "dist/index.js"]
