import bcrypt from "bcryptjs";

const BCRYPT_PREFIX_RE = /^\$2[aby]\$/;

/** o_user.password 历史是明文（admin / 123 等），新方案是 bcrypt 哈希。
 *  这个函数判断现有存储是否已经是 bcrypt 哈希。
 */
export function isHashed(stored: string | null | undefined): boolean {
  return typeof stored === "string" && BCRYPT_PREFIX_RE.test(stored);
}

/** bcrypt 哈希一个明文密码，cost=10 是 nodejs 通用平衡点（约 60ms） */
export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 10);
}

/** 校验明文密码是否匹配存储值。
 *  - 存储是 bcrypt 哈希 → bcrypt.compare
 *  - 存储是明文（老 admin / 老 SSO 用户）→ 直接 ===
 *  返回 { ok, needsUpgrade }；needsUpgrade 表示老明文匹配成功，可以让上层趁机升级到哈希。
 */
export async function verifyPassword(plain: string, stored: string | null | undefined): Promise<{ ok: boolean; needsUpgrade: boolean }> {
  if (stored == null) return { ok: false, needsUpgrade: false };
  if (isHashed(stored)) {
    const ok = await bcrypt.compare(plain, stored);
    return { ok, needsUpgrade: false };
  }
  // 明文兼容：成功后建议上层 hashPassword 重写存储
  return { ok: plain === stored, needsUpgrade: plain === stored };
}
