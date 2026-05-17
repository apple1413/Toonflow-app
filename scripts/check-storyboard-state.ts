// 只读：检查 o_storyboard 状态和失败原因
import "../src/env";
import { db } from "../src/utils/db";

async function main() {
  const sids = await db("o_storyboard")
    .select("id", "scriptId", "index", "state", "reason", "filePath")
    .orderBy("scriptId")
    .orderBy("index");
  console.log(`[storyboards] 共 ${sids.length} 条`);
  for (const s of sids) {
    console.log(
      `  id=${s.id} scriptId=${s.scriptId} S${String(s.index).padStart(2, "0")} state=${s.state} reason=${(s.reason ?? "-").slice(0, 80)} path=${(s.filePath ?? "-").slice(0, 50)}`,
    );
  }
  await db.destroy();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
