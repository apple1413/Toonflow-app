import db from "@/utils/db";

/**
 * Per-user 配置 fall-through 工具集。
 *
 * 读模式：用户优先 + admin 兜底默认。
 *   流程：查 WHERE userId IN (current, admin_id) OR userId IS NULL → 用 current 的行覆盖同 key
 *        的 admin 行 → admin 再覆盖 NULL 行 → 返回合并结果。
 *
 * 写模式：永远写当前用户行（upsert by userId+keyCol）。
 *   absent → INSERT，present → UPDATE，绝不动 admin 行。
 *
 * o_setting 特殊：tokenKey / 嵌入模型路径等系统级 key 用 userId IS NULL 表示"全局默认"。
 *   读时 NULL 当作 admin 兜底；写时这些 key 应当被显式从 per-user 写入路径排除。
 *
 * admin 用户识别：原版硬编码 ADMIN_USER_ID=1，本地 SQLite 单用户场景下合适。
 * 但切到共享 Supabase 后 id=1 可能是别的产品的用户（或被 SSO 占用），所以改为按 role='admin'
 * 动态查找；结果缓存在内存避免每次 query 多一次 round-trip。
 *
 * cache 失效：管理员变更不频繁，进程级 cache 不主动失效；admin 重置后重启服务即可。
 */
let cachedAdminUserId: number | null = null;
async function getAdminUserId(): Promise<number> {
  if (cachedAdminUserId !== null) return cachedAdminUserId;
  // 取 role='admin' 且 id 最小的那一行——多 admin 时也确定性返回主 admin
  const row = await db("o_user").where({ role: "admin" }).orderBy("id").select("id").first();
  cachedAdminUserId = row?.id ?? 1; // 兜底回 1，避免找不到 admin 时 fallthrough 整个崩
  return cachedAdminUserId;
}

/**
 * 合并查询：根据指定的"业务键"列（如 o_agentDeploy.key），用 current 用户的行覆盖 admin 的同键行。
 *
 * @param table         knex table 名（PG 在 toonflow schema 下、SQLite 直接同名）
 * @param userId        当前用户 id
 * @param dedupeKey     去重用的字段名，例如 "key" / "name" / 复合时见 mergeWith
 * @param where         可选的额外过滤条件（如 whereIn("key", [...])）
 */
export async function fallthroughList<T = any>(
  table: string,
  userId: number,
  dedupeKey: string,
  where?: (q: any) => void,
): Promise<T[]> {
  const adminUserId = await getAdminUserId();
  // userId 条件要包成一个 group 才行，否则后面 callback 加的 .where("key", ...)
  // 会被 SQL "AND > OR" 优先级吃掉：
  //   WHERE userId IN (?, ?) OR userId IS NULL AND key = ?
  //   等价于  WHERE userId IN (?, ?) OR (userId IS NULL AND key = ?)
  // —— current/admin 的行就被全量捞回来，key 过滤完全失效。
  const q = db(table as any).where(function (this: any) {
    this.whereIn("userId", [userId, adminUserId]).orWhereNull("userId");
  });
  if (where) where(q);
  const rows = (await q.select("*")) as any[];
  const map = new Map<any, any>();
  for (const row of rows) {
    const k = row[dedupeKey];
    const existing = map.get(k);
    // 当前用户的行最高优；admin 次之；NULL（全局默认）最低
    const priority = (r: any) =>
      Number(r.userId) === userId ? 2 : Number(r.userId) === adminUserId ? 1 : 0;
    if (!existing || priority(row) > priority(existing)) {
      map.set(k, row);
    }
  }
  return [...map.values()] as T[];
}

/**
 * Upsert by (userId, ...keyCols)。如果存在该 user 的同业务键行，就 update；否则 insert。
 *
 * @param table       表名
 * @param userId      当前用户 id
 * @param keyCols     用于定位"同一条业务记录"的列值（如 { key: "scriptAgent" } 或 { vendorId, model }）
 * @param fields      要写入/更新的字段（不应包含 keyCols 和 userId）
 */
export async function upsertForUser(
  table: string,
  userId: number,
  keyCols: Record<string, any>,
  fields: Record<string, any>,
): Promise<void> {
  const existing = await db(table as any).where({ userId, ...keyCols }).first();
  if (existing) {
    await db(table as any).where({ userId, ...keyCols }).update(fields);
  } else {
    await db(table as any).insert({ userId, ...keyCols, ...fields });
  }
}

export { getAdminUserId };
// 兼容老代码：保留同名导出，但内部走动态查询。
// 如果某些路由还以 `import { ADMIN_USER_ID } ...` 静态导入了这个常量，需要改成 await getAdminUserId()。
// 这里暴露一个 0 作为"未初始化"哨兵，让旧路径如果还在用立刻报错而不是悄悄取错数据。
export const ADMIN_USER_ID = 0;
