FROM node:22-slim AS base
RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@10.29.3 --activate
WORKDIR /app

# Copy workspace structure for dependency resolution
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.json ./
COPY packages/pipeline/package.json packages/pipeline/
COPY packages/api/package.json packages/api/

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source
COPY packages/pipeline/ packages/pipeline/
COPY packages/api/ packages/api/

# Generate Prisma client
RUN pnpm --filter @market-intel/pipeline db:generate

EXPOSE 3001

CMD ["pnpm", "--filter", "@market-intel/api", "start"]
