FROM node:24-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:24-alpine
RUN addgroup -S gt && adduser -S gt -G gt
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/postinstall.mjs ./
RUN npm ci --omit=dev && npm cache clean --force
USER gt
EXPOSE 3100
HEALTHCHECK CMD wget -qO- http://localhost:3100/health || exit 1
ENV GT_HTTP_PORT=3100
CMD ["node", "dist/index.js"]
