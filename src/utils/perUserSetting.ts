import db from "@/utils/db";

/**
 * Per-user 配置 fall-through 工具集。
 *
 * 读模式：用户优先 + admin (id=1) 兜底默认。
 *   流程：查 WHERE userId IN (current, 1) → 用 current 的行覆盖同 key 的 admin 行 → 返回合并结果。
 *
 * 写模式：永远写当前用户行（upsert by userId+keyCol）。
 *   absent → INSERT，present → UPDATE，绝不动 admin 行。
 *
 * o_setting 特殊：tokenKey / 嵌入模型路径等系统级 key 用 userId IS NULL 表示"全局默认"。
 *   读时 NULL 当作 admin 兜底；写时这些 key 应当被显式从 per-user 写入路径排除。
 *
 * 当前 admin = user.id === 1 (initData 注入)。等 P3-a 引入正式角色表后再改。
 */
const ADMIN_USER_ID = 1;

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
  const q = db(table as any).whereIn("userId", [userId, ADMIN_USER_ID]);
  // o_setting 这类把"全局默认"用 NULL 表示的表也要捎上
  q.orWhereNull("userId");
  if (where) where(q);
  const rows = (await q.select("*")) as any[];
  const map = new Map<any, any>();
  for (const row of rows) {
    const k = row[dedupeKey];
    const existing = map.get(k);
    // 当前用户的行最高优；admin (1) 次之；NULL（全局默认）最低
    const priority = (r: any) =>
      Number(r.userId) === userId ? 2 : Number(r.userId) === ADMIN_USER_ID ? 1 : 0;
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

export { ADMIN_USER_ID };
