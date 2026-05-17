// 只读：诊断"衍生资产 agent 说写了 7 条但 UI 刷新后看不到"
// 列出 o_assets 里所有 assetsId 不为 NULL 的（即衍生资产），及其父资产、scriptAssets 关联
import "../src/env";
import { db } from "../src/utils/db";

async function main() {
  const projectArg = process.argv[2];
  const projectFilter = projectArg ? { projectId: Number(projectArg) } : {};

  const parents = await db("o_assets")
    .where(projectFilter)
    .andWhere(function () {
      this.whereNull("assetsId").orWhere("assetsId", 0);
    })
    .orderBy("id");
  console.log(`[parents] 共 ${parents.length} 个`);
  for (const a of parents) {
    console.log(`  id=${a.id} name="${a.name}" projectId=${a.projectId} type=${a.type}`);
  }

  const derives = await db("o_assets")
    .where(projectFilter)
    .whereNotNull("assetsId")
    .andWhereNot("assetsId", 0)
    .orderBy("id");
  console.log(`\n[derives] 共 ${derives.length} 个`);
  for (const d of derives) {
    const parentName = parents.find((p) => p.id === d.assetsId)?.name ?? "(父不存在)";
    console.log(`  id=${d.id} name="${d.name}" assetsId=${d.assetsId}(${parentName}) projectId=${d.projectId} type=${d.type}`);
  }

  const sa = await db("o_scriptAssets").select("*").orderBy(["scriptId", "assetId"]);
  console.log(`\n[scriptAssets] 共 ${sa.length} 行`);
  for (const row of sa) {
    const assetName = [...parents, ...derives].find((a) => a.id === row.assetId)?.name ?? "(无对应资产)";
    console.log(`  scriptId=${row.scriptId} assetId=${row.assetId} ("${assetName}")`);
  }

  await db.destroy();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
