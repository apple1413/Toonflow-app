// 只读：检查 o_image 表，特别是衍生资产对应图片的状态和 errorReason
import "../src/env";
import { db } from "../src/utils/db";

async function main() {
  const projectArg = process.argv[2];
  if (!projectArg) {
    console.error("用法: tsx scripts/check-image-state.ts <projectId>");
    process.exit(1);
  }
  const projectId = Number(projectArg);

  const images = await db("o_image")
    .leftJoin("o_assets", "o_assets.imageId", "o_image.id")
    .where("o_assets.projectId", projectId)
    .select(
      "o_image.id as imageId",
      "o_image.state",
      "o_image.errorReason",
      "o_image.filePath",
      "o_assets.id as assetId",
      "o_assets.name as assetName",
      "o_assets.assetsId as parentAssetId",
    )
    .orderBy("o_image.id");

  console.log(`[images] 共 ${images.length} 条与本项目资产关联的图片`);
  for (const r of images) {
    const isDerive = r.parentAssetId != null && r.parentAssetId !== 0;
    console.log(
      `  imageId=${r.imageId} assetId=${r.assetId} name="${r.assetName}" ${isDerive ? "(衍生)" : "(原资产)"} state=${r.state} err=${r.errorReason ?? "-"} path=${r.filePath ?? "-"}`,
    );
  }
  await db.destroy();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
