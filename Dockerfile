# Builds the Next app into a single Bun binary and runs it on distroless.
#
#   docker build -t next-compiler .
#   docker run --rm -p 8080:8080 next-compiler
#   bun run smoke

# ---------- build ----------
FROM oven/bun:1.4.3 AS builder
WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY . .
# `next build` runs the adapter, which compiles `build/server`.
RUN bun run build

# ---------- run ----------
# The "cc" variant has glibc, libstdc++ and libgcc: the Bun runtime and
# native addons such as sharp need them. "static" and "base" do not have them.
FROM gcr.io/distroless/cc-debian13:nonroot
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=8080

COPY --from=builder --chown=nonroot:nonroot /app/build/server ./server

EXPOSE 8080
CMD ["./server"]
