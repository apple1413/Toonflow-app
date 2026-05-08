// 一次性脚本：连 Supabase Postgres 跑 initDB，验证 schema 能正确推上去。
// 用法：DATABASE_URL=... npx tsx scripts/test-supabase.ts
import knex from "knex";

(async () => {
  if (!process.env.DATABASE_URL) {
    console.error("缺少 DATABASE_URL");
    process.exit(1);
  }
  const k = knex({
    client: "pg",
    connection: {
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
    },
    // 与 src/utils/db.ts 保持一致：Toonflow 表落到 toonflow schema
    searchPath: ["toonflow", "public"],
    pool: { min: 0, max: 5 },
  });
  try {
    console.log(">>> 连接 Postgres");
    const ping = await k.raw("SELECT 1+1 AS r");
    console.log("ping ok:", ping.rows[0]);

    // ⚠️ 危险动作已移除：不再自动 DROP SCHEMA
    // 如果需要重置测试库，请手动在 Supabase SQL Editor 里执行：
    //   DROP SCHEMA public CASCADE; CREATE SCHEMA public;

    console.log(">>> 跑 initDB 推 schema（创建缺失的表/列/索引到 toonflow schema，不删既有数据）");
    const initDB = (await import("../src/lib/initDB")).default;
    await initDB(k);

    console.log(">>> 查 toonflow schema 下的表");
    const tables = await k.raw("SELECT tablename FROM pg_tables WHERE schemaname='toonflow' ORDER BY tablename");
    const names = tables.rows.map((r: any) => r.tablename);
    console.log("toonflow.* 表:", names);
    console.log("总数:", names.length);

    const publicCount = await k.raw("SELECT count(*)::int AS n FROM pg_tables WHERE schemaname='public'");
    console.log("public schema 表数（应保持不变）:", publicCount.rows[0].n);
    process.exit(0);
  } catch (e: any) {
    console.error("FAIL:", e.message);
    if (e.code) console.error("PG code:", e.code);
    if (e.detail) console.error("detail:", e.detail);
    process.exit(1);
  } finally {
    await k.destroy();
  }
})();
