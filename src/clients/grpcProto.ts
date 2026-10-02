/**
 * gRPC 客户端的公共部分：运行期加载随仓库携带的 `.proto`，把回调式一元调用
 * 包成 Promise，以及两个上游共用的字段映射。
 *
 * 本组件只当 gRPC 客户端（调 mdm-customer / mdm-product），从不对外提供
 * gRPC，所以不引入 codegen 工具链：`@grpc/proto-loader` 运行期直接读
 * `.proto` 生成调用桩，零额外构建步骤。`contracts/vendor/` 下的文件是上游
 * 发布 tag 上的原文（来源记在 `contracts/vendor/SOURCES.tsv`）。
 *
 * 加载选项：`keepCase` 取默认值 false，字段名自动转 camelCase；`enums: String`
 * 让枚举以 `"CUSTOMER_STATUS_ACTIVE"` 这样的字符串出现而不是裸数字；
 * `longs: Number` 把 int64（`version`）转成 JS number——version 不会大到
 * 超过 2^53，与 GraphQL schema 把 version 定成 Int 一致。
 */

import { loadSync } from "@grpc/proto-loader";
import * as grpc from "@grpc/grpc-js";
import { join } from "node:path";

// 按工作目录找 contracts/，不用 __dirname 反推：build 之后 dist/clients/
// 与 contracts/ 不再相邻，而容器 WORKDIR 与本地运行时的工作目录都是仓库根。
const VENDOR_ROOT = join(process.cwd(), "contracts/vendor");

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
 * 把 grpc-js 回调风格的一元调用包成 Promise：客户端方法签名是
 * `(request, callback)`，没有原生 Promise 版本。
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

export interface ProtoTimestamp {
  seconds: number;
  nanos: number;
}

/** google.protobuf.Timestamp → ISO 8601；缺省值按纪元零点给，与 proto 的零值语义一致。 */
export function timestampToISOString(ts: ProtoTimestamp | null | undefined): string {
  if (!ts) return new Date(0).toISOString();
  return new Date(ts.seconds * 1000 + Math.floor(ts.nanos / 1e6)).toISOString();
}

/** proto 枚举名带类型前缀（`PRODUCT_STATUS_ACTIVE`），GraphQL 枚举不带（`ACTIVE`）。 */
export function stripEnumPrefix(prefix: string, value: string): string {
  return value.startsWith(prefix) ? value.slice(prefix.length) : value;
}
