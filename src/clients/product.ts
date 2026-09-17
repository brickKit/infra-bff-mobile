/**
 * mdm-product gRPC 客户端——同 customer.ts 的既有判据：`data_scopes:
 * none`，但用户请求路径上仍然用 `userClient`（导读第 21 条）。
 */

import type { ServiceClientConstructor } from "@grpc/grpc-js";
import { userClient } from "besdk";
import { callUnary, loadVendorProto } from "./grpcProto.js";
import { DEP_MDM_PRODUCT } from "../dependencies.js";

const proto = loadVendorProto("mdm/product/v1/product.proto");
const ProductServiceCtor = (
  proto as unknown as {
    mdm: { product: { v1: { ProductService: ServiceClientConstructor } } };
  }
).mdm.product.v1.ProductService;

export interface ProductDTO {
  id: string;
  sku: string;
  name: string;
  categoryId: string;
  baseUomId: string;
  trackingType: "NONE" | "BATCH" | "SERIAL";
  standardCost: string;
  status: "ACTIVE" | "DISABLED";
  version: number;
  createdAt: string;
  updatedAt: string;
}

interface RawProduct {
  id: string;
  sku: string;
  name: string;
  categoryId: string;
  baseUomId: string;
  trackingType: string; // "TRACKING_TYPE_NONE" 等
  standardCost: string;
  status: string; // "PRODUCT_STATUS_ACTIVE" 等
  version: number;
  createdAt: { seconds: number; nanos: number } | null;
  updatedAt: { seconds: number; nanos: number } | null;
}

interface BatchGetResponse {
  products: RawProduct[];
  missingIds: string[];
}

function timestampToISOString(ts: { seconds: number; nanos: number } | null): string {
  if (!ts) return new Date(0).toISOString();
  return new Date(ts.seconds * 1000 + Math.floor(ts.nanos / 1e6)).toISOString();
}

function stripEnumPrefix(prefix: string, value: string): string {
  return value.startsWith(prefix) ? value.slice(prefix.length) : value;
}

function toDTO(raw: RawProduct): ProductDTO {
  return {
    id: raw.id,
    sku: raw.sku,
    name: raw.name,
    categoryId: raw.categoryId,
    baseUomId: raw.baseUomId,
    trackingType: stripEnumPrefix("TRACKING_TYPE_", raw.trackingType) as ProductDTO["trackingType"],
    standardCost: raw.standardCost,
    status: stripEnumPrefix("PRODUCT_STATUS_", raw.status) as ProductDTO["status"],
    version: raw.version,
    createdAt: timestampToISOString(raw.createdAt),
    updatedAt: timestampToISOString(raw.updatedAt),
  };
}

export async function batchGetProducts(auth: string, ids: readonly string[]): Promise<Array<ProductDTO | undefined>> {
  if (ids.length === 0) return [];
  const { target, credentials, options } = userClient(auth, DEP_MDM_PRODUCT, "grpc");
  const client = new ProductServiceCtor(target, credentials, options);
  try {
    const res = await callUnary<{ ids: readonly string[] }, BatchGetResponse>(
      client as unknown as { [method: string]: unknown },
      "BatchGet",
      { ids },
    );
    const byId = new Map(res.products.map((p) => [p.id, toDTO(p)]));
    return ids.map((id) => byId.get(id));
  } finally {
    client.close();
  }
}
