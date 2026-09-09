/**
 * mdm-customer gRPC 客户端——`data_scopes: none`，用户请求路径上必须用
 * `userClient`（不是 `systemClient`），即使这个组件目前不校验转发的身份
 * （导读第 21 条：路径本身是被审计的东西，不是"反正对方不检查就无所
 * 谓"）。
 */

import type { ServiceClientConstructor } from "@grpc/grpc-js";
import { userClient } from "besdk";
import { callUnary, loadVendorProto } from "./grpcProto.js";
import { DEP_MDM_CUSTOMER } from "../dependencies.js";

const proto = loadVendorProto("mdm/customer/v1/customer.proto");
const CustomerServiceCtor = (
  proto as unknown as {
    mdm: { customer: { v1: { CustomerService: ServiceClientConstructor } } };
  }
).mdm.customer.v1.CustomerService;

export interface CustomerDTO {
  id: string;
  code: string;
  name: string;
  taxNo: string;
  creditLimit: string;
  status: "ACTIVE" | "DISABLED";
  version: number;
  createdAt: string;
  updatedAt: string;
  contacts: Array<{ id: string; name: string; phone: string; email: string; primary: boolean }>;
  billingInfos: Array<{
    id: string;
    title: string;
    taxNo: string;
    bankName: string;
    bankAccount: string;
    address: string;
  }>;
}

interface RawCustomer {
  id: string;
  code: string;
  name: string;
  taxNo: string;
  creditLimit: string;
  status: string; // "CUSTOMER_STATUS_ACTIVE" | "CUSTOMER_STATUS_DISABLED" | "CUSTOMER_STATUS_UNSPECIFIED"
  version: number;
  createdAt: { seconds: number; nanos: number } | null;
  updatedAt: { seconds: number; nanos: number } | null;
  contacts: CustomerDTO["contacts"];
  billingInfos: CustomerDTO["billingInfos"];
}

interface BatchGetResponse {
  customers: RawCustomer[];
  missingIds: string[];
}

function timestampToISOString(ts: { seconds: number; nanos: number } | null): string {
  if (!ts) return new Date(0).toISOString();
  return new Date(ts.seconds * 1000 + Math.floor(ts.nanos / 1e6)).toISOString();
}

function stripEnumPrefix(prefix: string, value: string): string {
  return value.startsWith(prefix) ? value.slice(prefix.length) : value;
}

function toDTO(raw: RawCustomer): CustomerDTO {
  return {
    id: raw.id,
    code: raw.code,
    name: raw.name,
    taxNo: raw.taxNo,
    creditLimit: raw.creditLimit,
    status: stripEnumPrefix("CUSTOMER_STATUS_", raw.status) as CustomerDTO["status"],
    version: raw.version,
    createdAt: timestampToISOString(raw.createdAt),
    updatedAt: timestampToISOString(raw.updatedAt),
    contacts: raw.contacts ?? [],
    billingInfos: raw.billingInfos ?? [],
  };
}

/**
 * DataLoader 的 batchGet 函数——顺序/长度必须跟 `ids` 一一对应，查不到
 * 的位置填 `undefined`（`BatchGetResponse` 只返回找到的 + missingIds，
 * 这里按 `ids` 原始顺序重新拼出 DataLoader 要的形状）。
 */
export async function batchGetCustomers(auth: string, ids: readonly string[]): Promise<Array<CustomerDTO | undefined>> {
  if (ids.length === 0) return [];
  const { target, credentials, options } = userClient(auth, DEP_MDM_CUSTOMER);
  const client = new CustomerServiceCtor(target, credentials, options);
  try {
    const res = await callUnary<{ ids: readonly string[] }, BatchGetResponse>(
      client as unknown as { [method: string]: unknown },
      "BatchGet",
      { ids },
    );
    const byId = new Map(res.customers.map((c) => [c.id, toDTO(c)]));
    return ids.map((id) => byId.get(id));
  } finally {
    client.close();
  }
}
