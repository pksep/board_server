FROM node:20-slim AS base

RUN apt-get update && \
    apt-get install -y curl unzip gnupg2 lsb-release  && \
    rm -rf /var/lib/apt/lists/*

RUN curl -fsSL https://bun.sh/install | bash
ENV BUN_INSTALL="/root/.bun"
ENV PATH="$BUN_INSTALL/bin:$PATH"
ENV NODE_OPTIONS="--max_old_space_size=4096 --unhandled-rejections=strict"
ENV UV_THREADPOOL_SIZE=4

RUN curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc | gpg --dearmor -o /usr/share/keyrings/postgresql.gpg && \
    echo "deb [arch=amd64 signed-by=/usr/share/keyrings/postgresql.gpg] http://apt.postgresql.org/pub/repos/apt $(lsb_release -cs)-pgdg main" > /etc/apt/sources.list.d/pgdg.list && \
    apt-get update && \
    apt-get install -y postgresql-client-16 && \
    rm -rf /var/lib/apt/lists/*



COPY . /app
WORKDIR /app

FROM base AS deps
RUN --mount=type=cache,id=bun,target=/root/.bun/install/cache \
    bun install --frozen-lockfile || (echo "bun.lockb is missing or invalid, regenerating..." && bun install)

FROM base
COPY --from=deps /app/node_modules /app/node_modules

RUN npm install -g pm2 cross-env

RUN --mount=type=cache,id=build,target=/app/dist bun run build:lib && bun run build

RUN rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/*

EXPOSE 5000

CMD ["sh", "-c", "pm2-runtime start ecosystem.config.js --only instance1"]