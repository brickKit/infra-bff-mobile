IMAGE   := brickenterprise/infra-bff-mobile
VERSION := $(shell grep -E '^\s+version:' component.yaml | head -1 | awk '{print $$2}')

.DEFAULT_GOAL := help
.PHONY: help all check-version test image migrate-idempotent dag-check contract-check import-scan module-check docs-check smoke

help:  ## 列出所有目标
	@awk 'BEGIN{FS=":.*##"; printf "\n用法: make <目标>\n\n"} \
	     /^[a-zA-Z0-9_-]+:.*##/ {printf "  \033[36m%-18s\033[0m %s\n", $$1, $$2} \
	     /^##@/ {printf "\n\033[1m%s\033[0m\n", substr($$0,5)}' $(MAKEFILE_LIST)
	@echo ""

##@ 汇总
all: check-version test image dag-check contract-check import-scan module-check docs-check  ## 8 个门禁（不含 smoke，它要真起容器；migrate-idempotent 见下，本组件零数据库）

##@ 9 个门禁
check-version:  ## component.yaml 的 version、git tag、deployment.image 三者不许分叉（§9.1 两个真相源）
	@tag="$$(git describe --tags --exact-match 2>/dev/null || true)"; \
	 if [ -n "$$tag" ] && [ "$$tag" != "v$(VERSION)" ]; then \
	   echo "✗ git tag $$tag 与 component.yaml 的 $(VERSION) 不一致"; exit 1; fi; \
	 img_ver="$$(grep -E '^[[:space:]]+image:' component.yaml | head -1 | sed -E 's#.*:([0-9]+\.[0-9]+\.[0-9]+)[[:space:]]*$$#\1#')"; \
	 if [ "$$img_ver" != "$(VERSION)" ]; then \
	   echo "✗ deployment.image 的 tag ($$img_ver) 与 component.yaml 的 version ($(VERSION)) 不一致"; exit 1; fi; \
	 echo "✓ version=$(VERSION)（git tag 与 deployment.image 一致）"

test:  ## 需要真实 mdm-customer/mdm-product/infra-workflow 容器（TEST_*/MDM_*/INFRA_WORKFLOW_ENDPOINT env），缺省时相关用例自动跳过
	npm run typecheck
	npm test

image:  ## 建镜像并确认里面有 sh + wget（§12.3.7 健康检查需要）
	docker build -t $(IMAGE):$(VERSION) .
	@docker run --rm --entrypoint sh $(IMAGE):$(VERSION) -c 'wget --version >/dev/null' \
	  && echo "✓ 镜像里有 sh + wget"

migrate-idempotent:  ## N/A：本组件零持久化数据，没有迁移（§6.5 铁律二）
	@echo "N/A：infra-bff-mobile 零数据库，没有迁移可跑"

dag-check:  ## 强依赖图无环（§4.2）。一条强依赖都不能有——本组件在任何装配组合下都要能起来（设计计划 §5）
	@bad="$$(grep -A 20 '^dependencies:' component.yaml | grep -E '^\s*-' | grep -v 'optional: true' | grep -v '^\s*resources:' || true)"; \
	 if [ -n "$$bad" ]; then \
	   echo "✗ infra-bff-mobile 不许有强依赖，发现未标 optional: true 的条目："; echo "$$bad"; exit 1; fi
	@echo "✓ 全部依赖都是弱依赖，天然无环"

contract-check:  ## 手写 schema 语法合法 + vendor 的 proto 镜像 lint（§3.1，不做 buf breaking——这些不是本组件自己发布的契约）
	node_modules/.bin/tsx scripts/checkSchema.ts
	buf lint

import-scan:  ## 铁律六：不许 import 任何其他组件仓库（JS 生态里组件仓库互相不可能被 import 到，这里扫的是"没有绕开 contracts/vendor 直接引用别的组件仓库路径"这类反例）
	@bad="$$(grep -rlE "from ['\"]\.\./\.\./\.\./components/" src/ 2>/dev/null || true)"; \
	 if [ -n "$$bad" ]; then echo "✗ 直接引用了其他组件仓库的源码路径：$$bad"; exit 1; fi
	@echo "✓ 无组件间 import"

module-check:  ## 铁律七 + 本组件特有的裸 resolver 扫描（设计计划 §9 待决问题 1）
	@grep -qE 'export async function createModule\(rt: Runtime\): Promise<Module>' src/module.ts \
	   || { echo "✗ createModule 签名与总纲 §12.5.1 不一致"; exit 1; }
	@bad="$$(grep -rnE 'process\.env' src/ | grep -v 'src/main.ts\|dependencies.ts.*endpoint(' || true)"; \
	 if [ -n "$$bad" ]; then \
	   echo "✗ 模块代码里读了进程环境变量（§12.5.3、决讨 110）："; echo "$$bad"; exit 1; fi
	@bad="$$(grep -rlE 'createServer\(|\.listen\(' src/ | grep -v main.ts || true)"; \
	 if [ -n "$$bad" ]; then echo "✗ 模块代码里自己 listen（§13.3 铁律七）：$$bad"; exit 1; fi
	@# 裸 resolver 扫描（设计计划 §9 待决问题 1）：resolvers/ 目录下每个
	@# 字段值必须是 requirePermission(...) 包过的。用一个粗粒度的正则找
	@# "字段名: async (" 或 "字段名: (" 这种没经过 requirePermission 包装
	@# 的写法——真正精确的语法级扫描留给未来补一个 AST 版本，这里先守住
	@# 最常见的漏包装写法。
	@bad="$$(grep -rnE '^\s*[a-zA-Z]+: (async )?\(' src/resolvers/*.ts | grep -v requirePermission || true)"; \
	 if [ -n "$$bad" ]; then echo "✗ resolvers/ 下有没经过 requirePermission 包装的裸字段：$$bad"; exit 1; fi
	@echo "✓ 铁律七 + 裸 resolver 扫描通过"

docs-check:  ## 四份文档结构检查（总纲 §4 SOP-D）
	@bash ../../../infra/scripts/docs-check.sh infra-bff-mobile

smoke:  ## 原则一：只装这一个组件就能起来（§1.5、§3.11 第 8 条）
	@(cd ../../.. && brickkit up --dry-run >/dev/null) && echo "✓ smoke（完整版见 make tier0）"
