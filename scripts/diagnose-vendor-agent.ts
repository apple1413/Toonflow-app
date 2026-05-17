// 只读诊断：看 o_vendorConfig / o_agentDeploy 当前在 toonflow schema 下的分布情况
// 用法：DATABASE_URL=... npx tsx scripts/diagnose-vendor-agent.ts
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
    console.log("=== o_vendorConfig 分布 ===");
    const vc = await k("o_vendorConfig").select("id", "userId", "enable", "inputValues").orderBy("id");
    for (const r of vc) {
      const iv = (() => {
        try {
          const o = JSON.parse(r.inputValues ?? "{}");
          const keys = Object.keys(o);
          const hasApiKey = keys.includes("apiKey") && o.apiKey;
          return `${keys.length} keys${hasApiKey ? " [有 apiKey]" : ""}`;
        } catch { return "(JSON parse 失败)"; }
      })();
      console.log(`  id=${r.id} userId=${r.userId ?? "NULL"} enable=${r.enable} inputValues=${iv}`);
    }

    console.log("\n=== o_agentDeploy 分布 ===");
    const ad = await k("o_agentDeploy").select("id", "key", "userId", "modelName", "vendorId").orderBy("key").orderBy("userId");
    for (const r of ad) {
      console.log(`  key=${r.key} userId=${r.userId ?? "NULL"} modelName=${r.modelName ?? "(空)"} vendorId=${r.vendorId ?? "(空)"}`);
    }

    console.log("\n=== 诊断总结 ===");
    const vcGlobal = vc.filter((r: any) => r.userId == null);
    const vcUser = vc.filter((r: any) => r.userId != null);
    const adGlobal = ad.filter((r: any) => r.userId == null);
    const adUser = ad.filter((r: any) => r.userId != null);
    console.log(`vendorConfig: ${vcGlobal.length} 全局行 / ${vcUser.length} 用户行`);
    console.log(`agentDeploy: ${adGlobal.length} 全局行 / ${adUser.length} 用户行`);

    // 检查 admin (userId=1) 行是否比 NULL 全局行更"新"——如果是，需要先同步再删
    console.log("\n=== 待同步检查（admin id=1 → NULL 全局）===");
    let needSync = 0;
    for (const adminRow of vcUser.filter((r: any) => Number(r.userId) === 1)) {
      const globalRow = vcGlobal.find((g: any) => g.id === adminRow.id);
      const adminHasContent = !!adminRow.inputValues && adminRow.inputValues !== "{}";
      const globalEmpty = !globalRow || !globalRow.inputValues || globalRow.inputValues === "{}";
      if (adminHasContent && globalEmpty) {
        console.log(`  ⚠️  vendorConfig.${adminRow.id}: admin 有内容但全局空，需要同步`);
        needSync++;
      }
    }
    for (const adminRow of adUser.filter((r: any) => Number(r.userId) === 1)) {
      const globalRow = adGlobal.find((g: any) => g.key === adminRow.key);
      if (adminRow.modelName && (!globalRow || !globalRow.modelName)) {
        console.log(`  ⚠️  agentDeploy.${adminRow.key}: admin 有 modelName 但全局没有，需要同步`);
        needSync++;
      }
    }
    if (needSync === 0) console.log("  ✓ NULL 全局行已是最新，可以直接删除所有 userId 行");
    else console.log(`  共 ${needSync} 处待同步`);

    process.exit(0);
  } catch (e: any) {
    console.error("FAIL:", e.message);
    process.exit(1);
  } finally {
    await k.destroy();
  }
})();
