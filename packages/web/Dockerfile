FROM node:22-slim AS base
RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@10.29.3 --activate
WORKDIR /app

# Copy workspace structure for dependency resolution
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.json ./
COPY packages/pipeline/package.json packages/pipeline/
COPY packages/api/package.json packages/api/
COPY packages/web/package.json packages/web/

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source (web needs api + pipeline types at build time)
COPY packages/pipeline/ packages/pipeline/
COPY packages/api/ packages/api/
COPY packages/web/ packages/web/

# Generate Prisma client (needed for pipeline type exports)
RUN pnpm --filter @market-intel/pipeline db:generate

# Build React Router app
RUN pnpm --filter @market-intel/web build

EXPOSE 3000

CMD ["pnpm", "--filter", "@market-intel/web", "start"]
