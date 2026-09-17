# 多阶段构建——同 Go/Python 组件的既有模式：build 阶段装完整工具链
# 编译，运行阶段只留跑起来真正要用的东西。设计书 §12.4 锁定 Node 24
# （05b Task 9 真机验证时发现依赖树的 graphql@17/@prometheus-io/client
# 已经要求 Node ≥22，原来锁定的 Node 20 已经滞后，升到当前最新维护版
# LTS Node 24），基底必须带 shell（导读第 8 条：平台的健康检查是
# CMD-SHELL + wget，distroless/scratch 会让"已就绪"永远探测不到——
# node:24-slim 同样基于 Debian，带 /bin/sh，只需要额外装 wget）。
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
