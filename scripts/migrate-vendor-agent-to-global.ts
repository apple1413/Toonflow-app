// 一次性迁移：把 admin (userId=1) 的 vendorConfig / agentDeploy 行复制到 NULL 全局行
// 仅 INSERT，不 DELETE 任何旧行（旧的 admin/user 行留着，新代码不会再读它们）
// 用法：DATABASE_URL=... npx tsx scripts/migrate-vendor-agent-to-global.ts
import knex from "knex";

(async () => {
  if (!process.env.DATABASE_URL) {
    console.error("缺少 DATABASE_URL");
    process.exit(1);
  }
  const k = knex({
    client: "pg",
    connection: { connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } },
    searchPath: ["toonflow", "public"],
    pool: { min: 0, max: 3 },
  });
  try {
    let inserted = 0;
    let updated = 0;

    // ---- vendorConfig：admin 行同步到 NULL 全局 ----
    console.log("=== 同步 o_vendorConfig (admin → NULL 全局) ===");
    const vcAdmin = await k("o_vendorConfig").where("userId", 1).select("*");
    for (const a of vcAdmin) {
      const g = await k("o_vendorConfig").where("id", a.id).whereNull("userId").first();
      const adminEmpty = !a.inputValues || a.inputValues === "{}";
      const globalEmpty = !g || !g.inputValues || g.inputValues === "{}";
      if (adminEmpty) {
        console.log(`  skip ${a.id}: admin 行无内容`);
        continue;
      }
      if (!g) {
        await k("o_vendorConfig").insert({
          id: a.id, userId: null,
          inputValues: a.inputValues,
          enable: a.enable ?? 0,
          models: a.models ?? "[]",
        });
        console.log(`  INSERT NULL 全局行 ${a.id}`);
        inserted++;
      } else if (globalEmpty) {
        await k("o_vendorConfig").where({ id: a.id }).whereNull("userId").update({
          inputValues: a.inputValues,
          enable: g.enable ?? a.enable ?? 0,
        });
        console.log(`  UPDATE NULL 全局行 ${a.id}（原为空）`);
        updated++;
      } else {
        console.log(`  skip ${a.id}: NULL 全局行已有内容，不覆盖（admin=${a.inputValues.slice(0,40)}... global=${g.inputValues.slice(0,40)}...）`);
      }
    }

    // ---- agentDeploy：admin 行同步到 NULL 全局 ----
    console.log("\n=== 同步 o_agentDeploy (admin → NULL 全局) ===");
    const adAdmin = await k("o_agentDeploy").where("userId", 1).select("*");
    for (const a of adAdmin) {
      const g = await k("o_agentDeploy").where("key", a.key).whereNull("userId").first();
      if (!g) {
        // INSERT 新 NULL 行，复制 admin 的所有业务字段；自增 id 由 DB 生成
        const { id: _ignoredId, ...rest } = a;
        await k("o_agentDeploy").insert({ ...rest, userId: null });
        console.log(`  INSERT NULL 全局行 key=${a.key} modelName=${a.modelName ?? "(空)"}`);
        inserted++;
      } else {
        console.log(`  skip key=${a.key}: NULL 全局行已存在`);
      }
    }

    console.log(`\n=== 结果 ===`);
    console.log(`INSERT 新 NULL 全局行：${inserted}`);
    console.log(`UPDATE 已有 NULL 全局行（原空）：${updated}`);
    console.log(`未删除任何旧行（admin/user 行保留作历史，新代码不会读）`);
    process.exit(0);
  } catch (e: any) {
    console.error("FAIL:", e.message);
    if (e.detail) console.error("detail:", e.detail);
    process.exit(1);
  } finally {
    await k.destroy();
  }
})();
