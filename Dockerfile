# 多阶段构建：build 阶段装完整工具链编译 TypeScript，运行阶段只留生产依赖与
# 编译产物。Node 24：依赖树里的 graphql@17 与 @prometheus-io/client 要求
# Node ≥ 22。基底必须带 shell：平台的健康检查经 /bin/sh 调 wget，
# distroless / scratch 上"已就绪"永远探测不到；node:24-slim 基于 Debian，
# 带 /bin/sh，只需另装 wget。
FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:24-slim
RUN apt-get update && apt-get install -y --no-install-recommends wget ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
COPY contracts ./contracts
COPY component.yaml ./

EXPOSE 8500

ENTRYPOINT ["node", "dist/main.js"]
