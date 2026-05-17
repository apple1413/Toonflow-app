// 只读：检查所有 o_script 当前 extractState，以及关联的 o_scriptAssets 数量。
// 用途：诊断"提取资产 UI 一直转圈"是否后端实际未完成。
import "../src/env";
import { db } from "../src/utils/db";

async function main() {
  const scripts = await db("o_script")
    .select("id", "projectId", "name", "extractState", "errorReason")
    .orderBy("id", "desc");

  console.log(`[check] 共 ${scripts.length} 条剧本`);
  for (const s of scripts) {
    const relCount = await db("o_scriptAssets").where({ scriptId: s.id }).count<{ count: string | number }>({ count: "*" }).first();
    const cnt = Number((relCount as any)?.count ?? 0);
    const stateLabel: Record<string | number, string> = {
      "-1": "-1 失败",
      "0": "0 正在提取",
      "1": "1 完成",
      "2": "2 等待提取",
    };
    console.log(
      `  id=${s.id} projectId=${s.projectId} state=${stateLabel[String(s.extractState)] ?? s.extractState} 关联资产=${cnt} name="${s.name}" err=${s.errorReason ?? "-"}`,
    );
  }
  await db.destroy();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
