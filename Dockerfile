# One image definition, three targets: app, worker, ingest.
#   docker build --target app -t sv-app .
FROM node:22-alpine AS build
RUN apk add --no-cache openssl
WORKDIR /repo
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/core/package.json packages/core/
COPY services/worker/package.json services/worker/
COPY services/ingest/package.json services/ingest/
COPY extensions extensions
RUN npm ci
COPY . .
RUN npx prisma generate \
 && npm run build \
 && npm run build:services \
 && npm prune --omit=dev

FROM node:22-alpine AS runtime
RUN apk add --no-cache openssl
WORKDIR /repo
ENV NODE_ENV=production
COPY --from=build /repo/node_modules node_modules
COPY --from=build /repo/package.json ./
COPY --from=build /repo/prisma prisma
COPY --from=build /repo/packages packages

FROM runtime AS app
COPY --from=build /repo/build build
COPY --from=build /repo/public public
EXPOSE 3000
ENV PORT=3000
# Migrations run here; worker and ingest wait for the schema.
CMD ["sh", "-c", "npx prisma migrate deploy && npx react-router-serve ./build/server/index.js"]

FROM runtime AS worker
COPY --from=build /repo/services/worker/dist services/worker/dist
CMD ["node", "services/worker/dist/main.js"]

FROM runtime AS ingest
COPY --from=build /repo/services/ingest/dist services/ingest/dist
EXPOSE 8081
ENV PORT=8081
CMD ["node", "services/ingest/dist/main.js"]
