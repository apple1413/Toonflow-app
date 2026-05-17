/**
 * 给本地 admin 用户加一个 fake externalId（UUID），让 getCreditBalance 不再跳过
 *
 * 仅本地开发用 —— admin 默认 externalId=null，getBalance 会跳过 HTTP 调用
 * 直接返回 -1，前端积分组件就隐藏了。设个 UUID 后才会去 mock-credits-server 拿数。
 *
 * 跑：tsx scripts/set-test-external-id.ts
 *
 * 改成不同 UUID（比如想测 admin UUID 白名单）：
 *   TEST_UUID=9bad9009-6bf0-4113-8316-c97cc44eb1d6 tsx scripts/set-test-external-id.ts
 */

import "../src/env";
import { db } from "../src/utils/db";

// 用原始 knex 实例（不要走 utils.ts 的 dbClient wrapper，那个用 Object.assign
// 不复制 prototype 上的 .raw 方法，会报 "u.db.raw is not a function"）
const u = { db } as { db: typeof db };

const TEST_UUID =
  process.env.TEST_UUID || "00000000-0000-0000-0000-000000000001";
const TARGET_NAME = process.env.TARGET_USER || "admin";

async function ensureColumn(table: string, column: string, ddl: string) {
  const info = await u.db.raw(`PRAGMA table_info(${table})`);
  const cols: any[] = Array.isArray(info) ? info : (info?.rows ?? []);
  const has = cols.some((c: any) => c.name === column);
  if (!has) {
    console.log(`[set-test-external-id] schema 补丁: ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
    await u.db.raw(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
  }
}

(async () => {
  // 本地 SQLite 老 schema 可能没这几列（toonflow P4 改造后才加），先确保列存在
  await ensureColumn("o_user", "externalId", "TEXT");
  await ensureColumn("o_user", "role", "TEXT DEFAULT 'user'");
  await ensureColumn("o_user", "email", "TEXT");
  await ensureColumn("o_user", "disabled", "INTEGER DEFAULT 0");

  // admin 没显式 role 时把它标成 admin（多租户改造前的默认账户）
  await u.db("o_user").where({ name: "admin" }).whereNull("role").update({ role: "admin" });

  const user = await u.db("o_user").where({ name: TARGET_NAME }).first();
  if (!user) {
    console.error(`[set-test-external-id] 用户 "${TARGET_NAME}" 不存在`);
    process.exit(1);
  }
  console.log(`[set-test-external-id] 找到用户：`, {
    id: user.id,
    name: user.name,
    role: (user as any).role,
    oldExternalId: (user as any).externalId,
  });

  await u.db("o_user").where({ id: user.id }).update({ externalId: TEST_UUID });
  console.log(`[set-test-external-id] 已设置 externalId = ${TEST_UUID}`);

  const after = await u.db("o_user").where({ id: user.id }).first();
  console.log(`[set-test-external-id] 当前行：`, {
    id: after.id,
    name: after.name,
    role: (after as any).role,
    externalId: (after as any).externalId,
  });
  process.exit(0);
})().catch((e) => {
  console.error("[set-test-external-id] 失败:", e);
  process.exit(1);
});
