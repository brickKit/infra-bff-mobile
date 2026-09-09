/**
 * 测试夹具——真实的本地 JWKS/bundle 服务器，同 be-sdk-ts 自己
 * `test/helpers.ts`/`test/bundle.ts` 的既有模式（两边不能共享 import，
 * 分属两个仓库，逻辑逐字对应）。加密运算是真的（`jose` 的
 * `generateKeyPair`/`SignJWT` 都是真实实现），身份是测试用的。
 */

import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { SignJWT, exportJWK, generateKeyPair, calculateJwkThumbprint, type JWK, type KeyLike } from "jose";

export interface FakeJWKS {
  url: string;
  sign: (claims: Record<string, unknown> & { sub: string }) => Promise<string>;
  close: () => Promise<void>;
}

export async function startFakeJWKS(): Promise<FakeJWKS> {
  const { publicKey, privateKey } = await generateKeyPair("RS256", { extractable: true });
  const jwk: JWK = await exportJWK(publicKey);
  const kid = await calculateJwkThumbprint(jwk);
  jwk.kid = kid;
  jwk.alg = "RS256";
  jwk.use = "sig";
  const body = JSON.stringify({ keys: [jwk] });

  const server: Server = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(body);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;

  const sign = async (claims: Record<string, unknown> & { sub: string }): Promise<string> => {
    const iat = Math.floor(Date.now() / 1000);
    return new SignJWT({ ...claims, iat, exp: iat + 600 })
      .setProtectedHeader({ alg: "RS256", kid })
      .sign(privateKey as KeyLike);
  };

  return {
    url: `http://127.0.0.1:${port}/jwks.json`,
    sign,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

export interface FakeBundle {
  url: string;
  close: () => Promise<void>;
}

export async function startFakeBundle(roles: Record<string, string[]>): Promise<FakeBundle> {
  const body = JSON.stringify({ roles, stale_since: {} });
  const server: Server = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "application/json", etag: '"v1"' });
    res.end(body);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}/authz/bundle`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
