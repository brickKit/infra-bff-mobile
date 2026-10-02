/**
 * mdm-customer gRPC 客户端。客户主数据是 `data_scopes: none`（全员可见），所以
 * 走 gRPC BatchGet。即使对方不按调用者过滤，用户请求路径上也必须用
 * `userClient`（透传调用者身份）而不是 `systemClient`：路径本身是被审计的东西，
 * `make gates` 的 system-client-scan 扫的正是 resolver 目录里的 systemClient。
 */

import type { ServiceClientConstructor } from "@grpc/grpc-js";
import { userClient } from "besdk";
import { callUnary, loadVendorProto, stripEnumPrefix, timestampToISOString, type ProtoTimestamp } from "./grpcProto.js";
import { DEP_MDM_CUSTOMER } from "../dependencies.js";
import type { Caller } from "./restForward.js";

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
  createdAt: ProtoTimestamp | null;
  updatedAt: ProtoTimestamp | null;
  contacts: CustomerDTO["contacts"];
  billingInfos: CustomerDTO["billingInfos"];
}

interface BatchGetResponse {
  customers: RawCustomer[];
  missingIds: string[];
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
 * DataLoader 的 batchGet 函数：结果的顺序与长度必须与 `ids` 一一对应，查不到
 * 的位置填 `undefined`。BatchGet 只返回找到的 + missingIds，这里按 `ids` 的
 * 原始顺序重新拼出 DataLoader 要的形状。
 */
export async function batchGetCustomers(
  caller: Caller,
  ids: readonly string[],
): Promise<Array<CustomerDTO | undefined>> {
  if (ids.length === 0) return [];
  const { target, credentials, options } = userClient(caller.config, caller.auth, DEP_MDM_CUSTOMER, "grpc");
  const client = new CustomerServiceCtor(target, credentials, options);
  try {
    const res = await callUnary<{ ids: readonly string[] }, BatchGetResponse>(
      caller,
      DEP_MDM_CUSTOMER,
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
