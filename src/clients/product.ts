/**
 * mdm-product gRPC 客户端。产品主数据与客户一样是 `data_scopes: none`，走
 * gRPC；用户请求路径上同样只用 `userClient`（理由见 customer.ts）。
 */

import type { ServiceClientConstructor } from "@grpc/grpc-js";
import { userClient, type Config } from "besdk";
import { callUnary, loadVendorProto, stripEnumPrefix, timestampToISOString, type ProtoTimestamp } from "./grpcProto.js";
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
  createdAt: ProtoTimestamp | null;
  updatedAt: ProtoTimestamp | null;
}

interface BatchGetResponse {
  products: RawProduct[];
  missingIds: string[];
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

function newClient(config: Config, auth: string) {
  const { target, credentials, options } = userClient(config, auth, DEP_MDM_PRODUCT, "grpc");
  return new ProductServiceCtor(target, credentials, options);
}

/** DataLoader 的 batchGet 函数，形状要求同 customer.ts 的 batchGetCustomers。 */
export async function batchGetProducts(
  config: Config,
  auth: string,
  ids: readonly string[],
): Promise<Array<ProductDTO | undefined>> {
  if (ids.length === 0) return [];
  const client = newClient(config, auth);
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

interface ListResponse {
  products: RawProduct[];
  nextCursor: string;
}

export interface ProductSearch {
  q: string;
  cursor?: string;
  pageSize?: number;
}

/**
 * 按关键字找产品（List 的 q）：匹配 sku 或 name，前缀匹配排在前面。List 带着
 * mdm-product 的默认时间窗口，本组件不放宽它。
 */
export async function searchProducts(
  config: Config,
  auth: string,
  search: ProductSearch,
): Promise<{ products: ProductDTO[]; nextCursor: string }> {
  const client = newClient(config, auth);
  try {
    const res = await callUnary<Record<string, unknown>, ListResponse>(
      client as unknown as { [method: string]: unknown },
      "List",
      { q: search.q, cursor: search.cursor ?? "", pageSize: search.pageSize ?? 0 },
    );
    return { products: res.products.map(toDTO), nextCursor: res.nextCursor };
  } finally {
    client.close();
  }
}
