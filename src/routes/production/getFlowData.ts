import express from "express";
import u from "@/utils";
import { z } from "zod";
import { success, error } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { userIdOf, assertOwnsProject, assertOwnsScript } from "@/utils/ownership";
const router = express.Router();
import { FlowData } from "@/agents/productionAgent/tools";

export default router.post(
  "/",
  validateFields({
    projectId: z.number(),
    episodesId: z.number(),
  }),
  async (req, res) => {
    const { projectId, episodesId }: { projectId: number; episodesId: number } = req.body;
    const userId = userIdOf(req);
    await assertOwnsProject(userId, projectId);
    await assertOwnsScript(userId, episodesId);
    const sqlData = await u
      .db("o_agentWorkData")
      .where("projectId", String(projectId))
      .andWhere("episodesId", String(episodesId))
      .select("data")
      .first();

    const scriptData = await u.db("o_script").where("projectId", projectId).where("id", episodesId).first();
    const scriptAssets = await u.db("o_scriptAssets").where("scriptId", episodesId);
    const assetIds = scriptAssets.map((i) => i.assetId);
    const assetsData = await u
      .db("o_assets")
      .leftJoin("o_image", "o_assets.imageId", "o_image.id")
      .select("o_assets.*", "o_image.filePath", "o_image.state", "o_image.errorReason")
      // @ts-ignore
      .where("o_assets.id", "in", assetIds)
      .andWhere("o_assets.assetsId", null)
      .where("o_assets.projectId", projectId);

    let childAssetsData = await u
      .db("o_assets")
      .leftJoin("o_image", "o_assets.imageId", "o_image.id")
      .select("o_assets.*", "o_image.filePath", "o_image.state", "o_image.errorReason")
      .where("o_assets.projectId", projectId)
      // @ts-ignore
      .where("o_assets.assetsId", "in", assetIds)
      .whereNotNull("o_assets.assetsId");

    if (!sqlData) {
      const flowData: FlowData = {
        script: scriptData?.content ?? "",
        scriptPlan: "",
        assets: await Promise.all(
          assetsData.map(async (item) => ({
            id: item.id,
            name: item.name ?? "",
            type: item.type ?? "",
            prompt: item.prompt ?? "",
            desc: item.describe ?? "",
            src: item.filePath && (await u.oss.getSmallImageUrl(item.filePath!)),
            derive: await Promise.all(
              childAssetsData
                .filter((child) => child.assetsId === item.id)
                .map(async (child) => ({
                  id: child.id,
                  assetsId: item.id,
                  name: child.name ?? "",
                  type: child.type,
                  prompt: child.prompt,
                  desc: child.describe ?? "",
                  src: child.filePath && (await u.oss.getSmallImageUrl(child.filePath!)),
                  state: child.state ?? "未生成", //todo：矫正状态值
                })),
            ),
          })),
        ),
        storyboardTable: "",
        storyboard: [],
        //todo：矫正workbench数据
        //@ts-ignore
        workbench: {
          videoList: [],
        },
        // //todo：矫正封面数据
        // poster: {
        //   items: [],
        // },
      };
      return res.status(200).send(success(flowData));
    } else {
      try {
        const storyboardData = await u.db("o_storyboard").where({ scriptId: episodesId, projectId });

        await Promise.all(
          storyboardData.map(async (i) => {
            if (i.filePath) {
              try {
                i.filePath = await u.oss.getSmallImageUrl(i.filePath);
              } catch {
                i.filePath = "";
              }
            } else {
              i.filePath = "";
            }
          }),
        );
        const storyboardIds = storyboardData.map((i) => i.id);
        // 原 orderBy("rowid")：SQLite 隐式 ROWID 表插入顺序，PG 没有 → 切 PG 后 query throws，
        // try 块被 catch 静默吞掉 → res.status(400)，前端 production 画布全空。
        // 改 orderBy("id")：依赖 fixDB 给 o_assets2Storyboard 加的 BIGSERIAL id 列保留插入顺序。
        const assetsIds = await u.db("o_assets2Storyboard").whereIn("storyboardId", storyboardIds).orderBy("id");

        const assets2StoryboardMap: Record<number, number[]> = {};
        assetsIds.forEach((i) => {
          if (!assets2StoryboardMap[i.storyboardId!]) {
            assets2StoryboardMap[i.storyboardId!] = [];
          }
          assets2StoryboardMap[i.storyboardId!].push(i.assetId!);
        });
        const flowData = JSON.parse(sqlData!.data ?? "{}");
        flowData.assets = await Promise.all(
          assetsData.map(async (item) => ({
            id: item.id,
            name: item.name ?? "",
            type: item.type ?? "",
            prompt: item.prompt ?? "",
            desc: item.describe ?? "",
            src: item.filePath && (await u.oss.getSmallImageUrl(item.filePath!)),
            flowId: item.flowId,
            derive: await Promise.all(
              childAssetsData
                .filter((child) => child.assetsId === item.id)
                .map(async (child) => ({
                  id: child.id,
                  assetsId: item.id,
                  name: child.name ?? "",
                  prompt: child.prompt,
                  type: child.type,
                  desc: child.describe ?? "",
                  src: child.filePath && (await u.oss.getSmallImageUrl(child.filePath!)),
                  state: child.state ?? "未生成",
                  errorReason: child?.errorReason ?? "",
                  flowId: child.flowId,
                })),
            ),
          })),
        );
        flowData.storyboard = storyboardData
          .map((i) => ({
            id: i.id,
            index: i.index,
            duration: i.duration ? +i.duration : 0,
            prompt: i.prompt,
            associateAssetsIds: assets2StoryboardMap[i.id!] ?? [],
            src: i.filePath,
            state: i.state,
            videoDesc: i.videoDesc,
            shouldGenerateImage: i.shouldGenerateImage,
            reason: i?.reason ?? "",
            flowId: i.flowId,
            track: i.track,
            trackId: i.trackId,
          }))
          .sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
        res.status(200).send(success(flowData));
      } catch (err) {
        // 之前 catch 空抛 400 + 无 message，凡是这条路径任何 DB query 报错都被静默吞掉。
        // 实际遇到过：SQLite→PG 迁移时 `.orderBy("rowid")` 在 PG 不存在 → 整个画布数据空白。
        console.error("[getFlowData] 加载失败 projectId=%s episodesId=%s:", projectId, episodesId, err);
        res.status(400).send(error((err as any)?.message ?? "加载流程数据失败"));
      }
    }
  },
);
