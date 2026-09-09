/**
 * 动态 proto 加载——本组件只当 mdm-customer/mdm-product 的 gRPC 客户端
 * （data_scopes: none 的两个组件，见 contracts/schema.graphql 顶部
 * 注释），不需要一整套 codegen 工具链（ts-proto 之类）：`@grpc/proto-loader`
 * 运行时直接读 `.proto` 文件生成调用桩，够用且零额外构建步骤——本组件
 * 从不对外提供 gRPC（只当客户端），换个方向的 codegen 投入不划算。
 *
 * `keepCase: false`（默认值，不显式传）让字段名自动转 camelCase，
 * `enums: "String"` 让枚举值以 `"CUSTOMER_STATUS_ACTIVE"` 这种字符串
 * 而不是裸数字出现——两者都正好贴合 GraphQL schema 的命名风格，映射
 * 代码最少。`longs: Number`：`version` 等 int64 字段转成普通 JS
 * number（这两个组件的 version 不会真的大到超过 2^53，同 GraphQL
 * schema 把 version 定成 Int 的既有判断一致）。
 */

import { loadSync } from "@grpc/proto-loader";
import * as grpc from "@grpc/grpc-js";
import { join } from "node:path";

// CWD 相对路径，不用 __dirname 反推——同 schema.ts 的既有判断：build
// 之后 dist/clients/grpcProto.js 与 contracts/ 不再是相邻目录关系，而
// 容器 WORKDIR 保证 CWD 就是仓库根。
const VENDOR_ROOT = join(process.cwd(), "contracts/vendor");

export interface GrpcServiceDefinition {
  [method: string]: (...args: unknown[]) => unknown;
}

/** 加载一个 vendor 来的 .proto，返回 grpc-js 认得的包定义树。 */
export function loadVendorProto(relativePath: string): grpc.GrpcObject {
  const packageDefinition = loadSync(join(VENDOR_ROOT, relativePath), {
    longs: Number,
    enums: String,
    defaults: true,
    oneofs: true,
  });
  return grpc.loadPackageDefinition(packageDefinition);
}

/**
 * 把 grpc-js 传统回调风格的一元调用包成 Promise——`@grpc/grpc-js` 的
 * 客户端方法签名是 `(request, callback)`，没有原生 Promise 版本。
 */
export function callUnary<Req, Res>(
  client: { [method: string]: unknown },
  method: string,
  request: Req,
): Promise<Res> {
  return new Promise((resolve, reject) => {
    const fn = client[method] as (
      req: Req,
      cb: (err: grpc.ServiceError | null, res: Res) => void,
    ) => void;
    fn.call(client, request, (err, res) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(res);
    });
  });
}
