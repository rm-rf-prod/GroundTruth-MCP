FROM node:26-alpine AS builder
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml postinstall.mjs ./
# pnpm version comes from packageManager in package.json (shared stack).
RUN npm install -g "$(node -p "require('./package.json').packageManager")" && pnpm install --frozen-lockfile
COPY . .
RUN pnpm run build

FROM node:26-alpine
RUN addgroup -S gt && adduser -S gt -G gt
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json /app/pnpm-lock.yaml /app/pnpm-workspace.yaml /app/postinstall.mjs ./
RUN npm install -g "$(node -p "require('./package.json').packageManager")" && pnpm install --frozen-lockfile --prod && pnpm store prune
USER gt
EXPOSE 3100
HEALTHCHECK CMD wget -qO- http://localhost:3100/health || exit 1
ENV GT_HTTP_PORT=3100
CMD ["node", "dist/index.js"]
