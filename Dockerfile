FROM oven/bun:1.4.2 AS build
WORKDIR /app
COPY package.json bun.lock ./
COPY apps/server/package.json apps/server/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/db/package.json packages/db/package.json
RUN bun install --frozen-lockfile
COPY apps/server apps/server
COPY apps/web apps/web
COPY packages/db packages/db
COPY tsconfig.json turbo.json ./
RUN cd apps/web && bun run build

FROM oven/bun:1.4.2 AS auth
WORKDIR /app
COPY --from=build /app /app
ENV NODE_ENV=production PORT=3000
EXPOSE 3000
CMD ["sh", "-c", "bun run db:migrate && bun run start"]

FROM oven/bun:1.4.2 AS web
WORKDIR /app
COPY --from=build /app /app
ENV NODE_ENV=production PORT=3001
CMD ["bun", "run", "--filter", "@central-identity/web", "server"]
