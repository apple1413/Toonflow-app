import db from "@/utils/db";

/**
 * 取 JWT 签名密钥。优先级：
 *   1. 环境变量 TOONFLOW_TOKEN_KEY（生产推荐——避免明文落 DB，也方便统一轮换）
 *   2. o_setting where key='tokenKey'（initData 落库的随机 8 位字符串，单机 Electron 默认）
 *
 * 两处都没拿到就抛错——服务端无法签/验 token。
 *
 * 命名空间用 `toonflow_*` 规避跟其他产品同库时的环境变量重复。
 */
let cached: string | null = null;

export async function getTokenKey(): Promise<string> {
  if (cached) return cached;
  const fromEnv = process.env.TOONFLOW_TOKEN_KEY;
  if (fromEnv && fromEnv.trim()) {
    cached = fromEnv;
    return cached;
  }
  const setting = await db("o_setting").where({ key: "tokenKey" }).whereNull("userId").select("value").first();
  if (setting?.value) {
    cached = String(setting.value);
    return cached;
  }
  // 兜底：之前的旧库可能 userId 字段不存在/不限定；再宽松查一次
  const fallback = await db("o_setting").where({ key: "tokenKey" }).select("value").first();
  if (fallback?.value) {
    cached = String(fallback.value);
    return cached;
  }
  throw new Error("[tokenKey] 未配置：请设置 TOONFLOW_TOKEN_KEY 环境变量或在 o_setting 表插入 key='tokenKey' 的全局行");
}

/** 让测试或 `agentSetKey` 这类轮换密钥的代码强制重读一次 */
export function invalidateTokenKeyCache(): void {
  cached = null;
}
