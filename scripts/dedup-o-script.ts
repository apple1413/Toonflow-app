// 清理 o_script 表里 (projectId, name) 重复的行。
//
// 起因：setPlanData 路由原本是 "check then insert"，前端 onXmlTag 每个分镜
// complete 时都调一次（短时间内 N 次），并发请求都看到 "row not exists" 然后各自
// 都 INSERT，PG 上又没 (projectId, name) 唯一约束，于是同名剧本插出多行。
//
// 策略：按 (projectId, name) 分组，保留 max(id) 那一行（即最新插入的），其它行删除。
// 先删 o_scriptAssets 里对要删行的引用（避免孤儿）。
//
// 用法：tsx scripts/dedup-o-script.ts [--dry]
//   --dry  只打印将要删除的行，不实际删除
//
// 安全：只删 (projectId, name) 维度的重复行，不动唯一行；不动其它表（除 o_scriptAssets 的孤儿引用）。

import "../src/env";
// db 是 Object.assign 包过的可调用 wrapper，原型方法（raw 等）可能丢；
// 这里直接拿原始 knex 实例。
import { db } from "../src/utils/db";

async function main() {
  const dry = process.argv.includes("--dry");
  console.log(`[dedup-o-script] mode=${dry ? "DRY RUN" : "EXECUTE"}`);

  // 找出所有 (projectId, name) 分组下行数 > 1 的，列出每组的 max id（要保留的）
  const dupGroups: Array<{ projectId: number; name: string; keepId: number; total: number }> = await db
    .raw(
      `SELECT "projectId", name, MAX(id) AS "keepId", COUNT(*)::int AS total
       FROM "o_script"
       GROUP BY "projectId", name
       HAVING COUNT(*) > 1
       ORDER BY total DESC`,
    )
    .then((r: any) => r.rows ?? r);

  if (!dupGroups.length) {
    console.log("[dedup-o-script] 无重复，无需清理");
    await db.destroy();
    return;
  }

  const totalDupRows = dupGroups.reduce((acc, g) => acc + (g.total - 1), 0);
  console.log(`[dedup-o-script] 发现 ${dupGroups.length} 组重复，共 ${totalDupRows} 行待删除`);
  console.log(`[dedup-o-script] 详情（前 20 组）:`);
  for (const g of dupGroups.slice(0, 20)) {
    console.log(`  projectId=${g.projectId} name="${g.name}" 共 ${g.total} 行，保留 id=${g.keepId}`);
  }

  // 收集所有待删 id：同组内除 keepId 外的所有 id
  const toDeleteIds: number[] = [];
  for (const g of dupGroups) {
    const rows = await db("o_script")
      .where({ projectId: g.projectId, name: g.name })
      .andWhere("id", "<>", g.keepId)
      .select("id");
    toDeleteIds.push(...rows.map((r: any) => Number(r.id)));
  }
  console.log(`[dedup-o-script] 待删 o_script ids 共 ${toDeleteIds.length} 个`);

  if (dry) {
    console.log("[dedup-o-script] DRY 模式，结束（未做任何修改）");
    await db.destroy();
    return;
  }

  // 删 o_scriptAssets 里指向这些行的引用，避免孤儿
  if (toDeleteIds.length > 0) {
    const orphanCount = await db("o_scriptAssets").whereIn("scriptId", toDeleteIds).delete();
    console.log(`[dedup-o-script] 已删 o_scriptAssets 孤儿行 ${orphanCount} 个`);

    // 真正删除重复的 o_script 行
    const deletedCount = await db("o_script").whereIn("id", toDeleteIds).delete();
    console.log(`[dedup-o-script] 已删 o_script 重复行 ${deletedCount} 个`);
  }

  await db.destroy();
  console.log("[dedup-o-script] 完成");
}

main().catch((e) => {
  console.error("[dedup-o-script] 失败:", e);
  process.exit(1);
});
