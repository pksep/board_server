# syntax=docker/dockerfile:1.7

FROM node:20-slim AS base

ENV BUN_INSTALL=/root/.bun
ENV PATH=$BUN_INSTALL/bin:$PATH

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl unzip \
    && rm -rf /var/lib/apt/lists/* \
    && curl -fsSL https://bun.sh/install | bash

FROM base AS deps
WORKDIR /app/board_server

COPY contracts/package.json /app/contracts/package.json
COPY contracts/dist /app/contracts/dist
COPY board_server/package.json /app/board_server/package.json
COPY board_server/bun.lock /app/board_server/bun.lock
COPY board_server/.npmrc /app/board_server/.npmrc

RUN --mount=type=cache,target=/root/.bun/install/cache \
    bun install --frozen-lockfile --ignore-scripts \
    || bun install --ignore-scripts

FROM deps AS build

COPY board_server/tsconfig.json /app/board_server/tsconfig.json
COPY board_server/tsconfig.build.json /app/board_server/tsconfig.build.json
COPY board_server/nest-cli.json /app/board_server/nest-cli.json
COPY board_server/src /app/board_server/src

RUN bun run build

FROM node:20-slim AS runtime
WORKDIR /app/board_server

ENV NODE_ENV=production

COPY --from=deps /app/contracts /app/contracts
COPY --from=deps /app/board_server/node_modules /app/board_server/node_modules
COPY --from=build /app/board_server/dist /app/board_server/dist
COPY board_server/package.json /app/board_server/package.json

EXPOSE 5000

CMD ["node", "dist/main.js"]
