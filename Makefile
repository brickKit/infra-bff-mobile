ID      := infra/bff-mobile
REPO    := infra-bff-mobile
VERSION := $(shell grep -m1 -E '^  version:' component.yaml | awk '{print $$2}')
# 项目根：本组件在项目里固定挂在 components/<scope>/<name>/ 下
ROOT    := ../../..

.DEFAULT_GOAL := help
.PHONY: help all check-version test test-e2e migrate-idempotent dag-check contract-check import-scan module-check docs-check smoke image

help:  ## 列出所有目标
	@awk 'BEGIN{FS=":.*##"; printf "\n用法: make <目标>\n\n"} \
	     /^[a-zA-Z0-9_-]+:.*##/ {printf "  \033[36m%-18s\033[0m %s\n", $$1, $$2} \
	     /^##@/ {printf "\n\033[1m%s\033[0m\n", substr($$0,5)}' $(MAKEFILE_LIST)
	@echo ""

##@ 汇总
all: check-version test dag-check contract-check import-scan module-check docs-check  ## 全部门禁（不含要起容器的 smoke / image，不含要真实下游的 test-e2e）

##@ 门禁
check-version:  ## metadata.version、package.json 的 version、HEAD 上的 tag 三者一致（TS 组件只有裸 tag）
	@test -n "$(VERSION)" || { echo "✗ component.yaml 里读不到 metadata.version"; exit 1; }
	@pkg="$$(node -p 'require("./package.json").version')" || { echo "✗ 读不了 package.json"; exit 1; }; \
	 [ "$$pkg" = "$(VERSION)" ] || { echo "✗ package.json 的 version（$$pkg）与 component.yaml 的 $(VERSION) 不一致"; exit 1; }
	@tags="$$(git tag --points-at HEAD | grep -E '^v?[0-9]+\.[0-9]+\.[0-9]+$$' || true)"; \
	 if [ -n "$$tags" ] && [ "$$tags" != "$(VERSION)" ]; then \
	   echo "✗ HEAD 上的版本 tag（$$(echo $$tags)）应当恰好是 $(VERSION)：TS 组件只打 brickKit 的裸 tag"; exit 1; fi
	@echo "✓ version=$(VERSION)（package.json 一致；HEAD 上没有 tag，或恰好是 $(VERSION)）"

test:  ## 类型检查 + vitest（下游全是本机桩，不需要任何容器）。真实下游的用例在 test-e2e
	npm run typecheck
	npm test

test-e2e:  ## 对真实下游跑端到端用例。缺 TEST_* 变量时失败，而不是全部跳过显示通过（变量见 test/e2e.test.ts 开头）
	@# vitest 对 skipIf 的用例照样退出 0：所以这里先查变量，缺哪个就点名失败。
	@missing=""; \
	 for v in TEST_MDM_CUSTOMER_ENDPOINT TEST_INFRA_WORKFLOW_ENDPOINT TEST_ERP_SALES_ENDPOINT TEST_CUSTOMER_ID; do \
	   eval "val=\$${$$v:-}"; [ -n "$$val" ] || missing="$$missing $$v"; \
	 done; \
	 [ -z "$$missing" ] || { echo "✗ 没设$$missing：端到端用例会全部 SKIP 而显示通过"; exit 1; }
	npx vitest run test/e2e.test.ts

migrate-idempotent:  ## 不适用：本组件不连数据库，没有迁移
	@echo "不适用：$(ID) 不连数据库，没有迁移可跑"

dag-check:  ## 每条依赖都是 @$(VERSION) 的 optional：本组件在任何装配组合下都要能起来，缺哪个依赖就裁掉哪些字段
	@python3 -c 'import sys, yaml; \
	m = yaml.safe_load(open("component.yaml")); \
	deps = (m.get("dependencies") or {}).get("components") or []; \
	bad = [str(d) for d in deps if not (isinstance(d, dict) and d.get("optional") is True and str(d.get("id", "")).endswith("@2.0.0"))]; \
	print("\n".join("✗ 不是 @2.0.0 的 optional 依赖：" + b for b in bad)) if bad else print("✓ %d 条依赖全部是 @2.0.0 的 optional，天然无环" % len(deps)); \
	sys.exit(1 if bad else 0)'

contract-check:  ## schema.graphql 合法且相对上一个发布 tag 只增不改；vendor 的 proto 镜像 buf lint
	@# 对比 main 抓不住已经提交到 main 上的破坏性改动（在 main 上工作时等于自己比自己），
	@# 所以对比上一个组件版本 tag。找不到 tag 时失败，而不是悄悄只做语法检查。
	@base="$$(git describe --tags --abbrev=0 2>/dev/null)" || { echo "✗ 找不到上一个发布 tag（先 git fetch --tags）"; exit 1; }; \
	 echo "graphql breaking --against '$$base'"; node_modules/.bin/tsx scripts/checkSchema.ts --against "$$base"
	buf lint

import-scan:  ## 只依赖 SDK：不引用别的组件仓库的源码，package.json 里除 be-sdk-ts 外没有 brickKit 的包
	@bad="$$(grep -rnE "from ['\"](\.\./){3,}" src/ test/ scripts/)"; status=$$?; \
	 [ $$status -le 1 ] || { echo "✗ grep 失败，没法扫 import"; exit 1; }; \
	 [ -z "$$bad" ] || { echo "✗ 引用了仓库之外的源码："; echo "$$bad"; exit 1; }
	@node -e 'const p = require("./package.json"); const all = { ...p.dependencies, ...p.devDependencies }; const bad = Object.entries(all).filter(([, v]) => /brickKit\//i.test(v) && !/brickKit\/be-sdk-ts\.git#/.test(v)); if (bad.length) { console.log("✗ 依赖了别的 brickKit 仓库：" + bad.map(([k, v]) => k + "=" + v).join(", ")); process.exit(1); }'
	@echo "✓ 无组件间 import"

module-check:  ## 入口签名对、零 process.env、不自己 listen、不做进程级初始化、resolver 全部经 requirePermission
	@grep -qE 'export async function createModule\(rt: Runtime\): Promise<Module>' src/module.ts \
	   || { echo "✗ createModule 的签名不对"; exit 1; }
	@# main.ts 是独立运行的装配代码（runStandalone），不在扫描范围内；注释行不扫，
	@# 免得解释"为什么不许读 process.env"的注释把自己判成违规。
	@bad="$$(grep -rnE 'process\.env|process\.exit|process\.on\(|createServer\(|\.listen\(|createYoga\(' src/ | grep -v '^src/main\.ts:' | grep -vE '^[^:]+:[0-9]+:[[:space:]]*(\*|//|/\*)')"; \
	 [ -z "$$bad" ] || { echo "✗ 模块代码读了进程环境、自己 listen、自己建 Yoga 或做了进程级初始化："; echo "$$bad"; exit 1; }
	@# 裸 resolver 扫描（与 make gates 的 bare-route-scan 同一判据）：resolvers/ 下值直接是
	@# 函数（箭头函数或 function）的字段必须先经过 requirePermission(…)。漏包装的字段
	@# 没有任何权限检查，也没有症状。按行扫描看不见换行的参数列表，所以
	@# test/resolvers.test.ts 还会逐个调用每个根字段，确认它在鉴权之前就失败关闭。
	@bad="$$(grep -nE '^[[:space:]]*[A-Za-z_]+[[:space:]]*:[[:space:]]*(async[[:space:]]+)?(\([^)]*\)[[:space:]]*(:[^=]+)?=>|function\b)' src/resolvers/*.ts)"; status=$$?; \
	 [ $$status -le 1 ] || { echo "✗ grep 失败，没法扫 resolvers/"; exit 1; }; \
	 [ -z "$$bad" ] || { echo "✗ resolvers/ 下有没经过 requirePermission 包装的字段："; echo "$$bad"; exit 1; }
	@echo "✓ 入口签名对、零 process.env、零进程级初始化、resolver 全部带权限键"

docs-check:  ## 清单与文档的严格 lint（= 项目根 make docs-check ID=$(ID)）
	@cd $(ROOT) && brickkit lint --strict $(ID)

##@ 要起容器的检查（在项目里跑）
smoke:  ## 项目能为本组件生成部署文件（brickkit up --dry-run）
	@cd $(ROOT) && brickkit up --dry-run >/dev/null && echo "✓ smoke：up --dry-run 通过"

image:  ## brickkit build 本组件，并确认镜像里有 sh + wget（健康检查经 /bin/sh 调 wget）
	@cd $(ROOT) && brickkit build $(ID)
	@docker run --rm --entrypoint sh $(REPO):$(VERSION) -c 'wget --version >/dev/null && test -f /app/component.yaml' \
	  && echo "✓ 镜像 $(REPO):$(VERSION) 里有 sh + wget + component.yaml"
