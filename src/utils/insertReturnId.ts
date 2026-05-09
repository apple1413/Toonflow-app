import db from "@/utils/db";

/**
 * 跨驱动的 INSERT 取自增 id 工具。
 *
 * 背景：在 SQLite (better-sqlite3) 下，`await knex(table).insert(row)` 返回 `[lastRowId]`，
 *   所以代码里散布着 `const [id] = await u.db("X").insert({...})` 的写法。
 *   到了 Postgres，默认情况下 INSERT 不会返回 lastInsertId，上述解构会拿到 undefined。
 *
 * 这个 helper 强制使用 `.returning("id")`：
 *   - PG 返回 `[{ id }]`
 *   - better-sqlite3 同样支持 `.returning("id")`，返回 `[{ id }]` 或 `[id]`（视 knex 版本）
 *   - 我们把两种形态归一成 number
 *
 * 用法：const id = await insertReturnId("o_script", { name, ... });
 */
export async function insertReturnId<T extends string>(table: T, row: any): Promise<number> {
  const [r] = await db(table as any).insert(row).returning("id");
  if (r == null) throw new Error(`[insertReturnId] ${table}: insert returned empty`);
  return typeof r === "object" ? Number((r as any).id) : Number(r);
}
