import express from "express";
import u from "@/utils";
import { z } from "zod";
import sharp from "sharp";
import { error, success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { Output, tool } from "ai";
import { assetItemSchema } from "@/agents/productionAgent/tools";
import { userIdOf, assertOwnsProject, assertOwnsScript, assertOwnsStoryboards } from "@/utils/ownership";
import { chargeForModel, refundCharge, estimateCostForModel, getBalance, InsufficientCreditsError } from "@/utils/credits";
const router = express.Router();
export type AssetData = z.infer<typeof assetItemSchema>;

export default router.post(
  "/",
  validateFields({
    storyboardIds: z.array(z.number()),
    projectId: z.number(),
    scriptId: z.number(),
    concurrentCount: z.number().min(1).optional(),
    compulsory: z.boolean().optional(),
  }),
  async (req, res) => {
    const {
      storyboardIds,
      projectId,
      scriptId,
      concurrentCount = 5,
      compulsory = false,
    }: {
      storyboardIds: number[];
      projectId: number;
      scriptId: number;
      concurrentCount: number;
      compulsory: boolean;
    } = req.body;
    if (!storyboardIds || storyboardIds.length === 0) return res.status(400).send(error("storyboardIds不能为空"));
    const userId = userIdOf(req);
    await assertOwnsProject(userId, projectId);
    await assertOwnsScript(userId, scriptId);
    await assertOwnsStoryboards(userId, storyboardIds);

    // 真实成本扣费：改成 per-image，每个分镜按 (vendor, model) 实际单价扣
    // - 预检：先查一次余额，若一张图都扣不起直接 402（避免无谓往下走）
    // - 实扣：放到下面 generateTask 里，单张失败时按 task_id 退款（幂等）
    const userRow = await u.db("o_user").where({ id: userId }).select("externalId").first();
    const externalId = (userRow?.externalId as string) ?? "";

    // 当没有 storyboardIds 时，通过 AI 生成新的分镜面板数据
    let finalStoryboardIds: number[] = storyboardIds || [];
    // shouldGenerateImage === 0 的分镜标记为「未生成」，其余标记为「生成中」
    const storyboardData = await u.db("o_storyboard").where("scriptId", scriptId).where("projectId", projectId).whereIn("id", finalStoryboardIds);
    if (!storyboardData.length) return res.status(500).send(error("未查到分镜数据"));
    const storyIds = storyboardData.map((i) => i.id);

    // 提前查 model（pre-flight 余额估算需要）
    const projectSettingData = await u.db("o_project").where("id", projectId).select("imageModel", "imageQuality", "artStyle", "videoRatio").first();

    // pre-flight 余额估算：把这批要真生成的分镜按 perImage 成本估总价，余额不够直接 402
    // 这里的 generateCount 跟下面 generateList 的判定一致：compulsory 全跑，否则只跑 shouldGenerateImage===1
    const willGenerateCount = compulsory
      ? storyboardData.length
      : storyboardData.filter((i) => i.shouldGenerateImage !== 0).length;
    if (externalId && willGenerateCount > 0) {
      const [imgVendor, imgModelName] = String(projectSettingData?.imageModel ?? "").split(/:(.+)/);
      if (imgVendor && imgModelName) {
        const perImageCost = await estimateCostForModel(imgVendor, imgModelName, "image", {
          size: projectSettingData?.imageQuality as string,
          count: 1,
        });
        const totalEstimate = perImageCost * willGenerateCount;
        if (totalEstimate > 0) {
          const balance = await getBalance(externalId);
          if (balance >= 0 && balance < totalEstimate) {
            return res.status(402).send(
              error(`积分不足：本次需要 ${totalEstimate}（${willGenerateCount} 张 × ${perImageCost}/张），剩余 ${balance}`),
            );
          }
        }
      }
    }

    if (compulsory) {
      await u.db("o_storyboard").whereIn("id", storyIds).where("scriptId", scriptId).update({ state: "生成中", shouldGenerateImage: 1 });
    } else {
      await u.db("o_storyboard").whereIn("id", storyIds).where("scriptId", scriptId).where("shouldGenerateImage", 0).update({ state: "未生成" });
      await u.db("o_storyboard").whereIn("id", storyIds).where("scriptId", scriptId).where("shouldGenerateImage", 1).update({ state: "生成中" });
    }

    // 按插入顺序查每个 storyboard 关联的 assetId（PG 无 rowid，用 fixDB 加的 BIGSERIAL id 列）
    const assets2StoryboardRows = await u
      .db("o_assets2Storyboard")
      .whereIn("storyboardId", storyIds)
      .orderBy("id")
      .select("storyboardId", "assetId");

    // 收集所有 assetId，批量查对应的 imageId
    const allAssetIds = [...new Set(assets2StoryboardRows.map((r: any) => r.assetId))];
    const assetImageMap: Record<number, number> = {};
    if (allAssetIds.length > 0) {
      const assetRows = await u.db("o_assets").whereIn("id", allAssetIds).select("id", "imageId");
      assetRows.forEach((row: any) => {
        assetImageMap[row.id] = row.imageId;
      });
    }

    // 按 rowid 顺序重建 assetRecord，值为有序的 imageId 列表
    const assetRecord: Record<number, number[]> = {};
    assets2StoryboardRows.forEach((item: any) => {
      if (!assetRecord[item.storyboardId]) {
        assetRecord[item.storyboardId] = [];
      }
      const imageId = assetImageMap[item.assetId];
      if (imageId != null) {
        assetRecord[item.storyboardId].push(imageId);
      }
    });
    const realStoryData = await u.db("o_storyboard").where("scriptId", scriptId).where("projectId", projectId).whereIn("id", storyIds);
    res.status(200).send(
      success(
        realStoryData.map((i) => ({
          id: i.id,
          prompt: i.prompt,
          associateAssetsIds: assetRecord[i.id!],
          src: null,
          state: i.state,
          videoDesc: i.videoDesc,
          shouldGenerateImage: i.shouldGenerateImage,
        })),
      ),
    );

    const [imgVendor, imgModelName] = String(projectSettingData?.imageModel ?? "").split(/:(.+)/);

    const generateTask = async (item: (typeof storyboardData)[number]) => {
      const repeloadObj = {
        prompt: item.prompt!,
        size: projectSettingData?.imageQuality as "1K" | "2K" | "4K",
        aspectRatio: projectSettingData?.videoRatio as `${number}:${number}`,
      };
      // 每张图独立 task_id（便于失败时按 task 退款；幂等也是按 task_id 走的）
      // 短 task_id（mixvoice trans_no 列实测上限 ~40 字符）
      const perImageTaskId = `tfsb_${scriptId}_${item.id}_${Date.now().toString(36)}`;
      let charged = 0;
      // per-image 扣费：余额已 pre-flight 过，这里几乎不会 402；真 402 直接标失败
      try {
        const r = await chargeForModel({
          userExternalId: externalId,
          vendor: imgVendor,
          model: imgModelName,
          kind: "image",
          input: { size: repeloadObj.size, count: 1 },
          taskId: perImageTaskId,
          fallbackScene: "image_generation",
        });
        charged = r.charged;
      } catch (e: any) {
        if (e instanceof InsufficientCreditsError) {
          await u.db("o_storyboard").where("id", item.id).update({
            filePath: "",
            reason: `积分不足：需要 ${e.required}，剩余 ${e.remaining}`,
            state: "生成失败",
          });
          return;
        }
        console.error(`[batchGenerateImage] charge 失败 sb=${item.id}`, e);
        await u.db("o_storyboard").where("id", item.id).update({
          filePath: "",
          reason: `扣费失败: ${u.error(e).message}`,
          state: "生成失败",
        });
        return;
      }
      try {
        const imageCls = await u.Ai.Image(projectSettingData?.imageModel as `${string}:${string}`).run(
          {
            referenceList: await getAssetsImageBase64(assetRecord[item.id!] || []),
            ...repeloadObj,
          },
          {
            taskClass: "生成分镜图片",
            describe: "分镜图片生成",
            relatedObjects: JSON.stringify(repeloadObj),
            projectId: projectId,
          },
        );
        const savePath = `/${projectId}/assets/${scriptId}/${u.uuid()}.jpg`;
        await imageCls.save(savePath);
        await u.db("o_storyboard").where("id", item.id).update({
          filePath: savePath,
          state: "已完成",
        });
      } catch (e) {
        await u.db("o_storyboard")
          .where("id", item.id)
          .update({
            filePath: "",
            reason: u.error(e).message,
            state: "生成失败",
          });
        // 生成失败按 task_id 退款（幂等）；charged===0 时跳过避免无意义 HTTP
        if (charged > 0) {
          await refundCharge({
            userExternalId: externalId,
            taskId: perImageTaskId,
            reason: `image failed: ${u.error(e).message}`,
          });
        }
      }
    };
    // 按 concurrentCount 控制并发数，分批执行；跳过 shouldGenerateImage === 0 的分镜
    let generateList = [];
    if (compulsory) {
      generateList = storyboardData;
    } else {
      generateList = storyboardData.filter((item) => item.shouldGenerateImage !== 0);
    }

    // 排查警告：路由会因为 shouldGenerateImage / prompt 缺失而静默"跳过全部"，对前端来说像是
    // 200 响应但永远拉不到生成结果。这里把这种"收到 N 个、实际生 0 个"的情况显式打出来，
    // 至少 log 里能 grep 到。常见根因：productionAgent 创建分镜骨架后没走完 prompt 生成 +
    // shouldGenerateImage=1 这两步就触发了 batchGenerateImage（顺序错乱）
    if (generateList.length === 0) {
      const noPromptCount = storyboardData.filter((i) => !i.prompt).length;
      const noFlagCount = storyboardData.filter((i) => i.shouldGenerateImage === 0).length;
      console.warn(
        `[batchGenerateImage] script=${scriptId} 收到 ${storyboardData.length} 个分镜但实际启动 0 个生图任务 ` +
          `(compulsory=${compulsory}, shouldGenerateImage=0 共 ${noFlagCount} 个, prompt 为空 ${noPromptCount} 个)。` +
          `检查 productionAgent 是否漏了 prompt 生成或 shouldGenerateImage=1 的步骤。`,
      );
    } else {
      // 防御性：generateList 里若有 prompt 为空的，跑也是白跑（AI image 会失败）
      // 这里只 warn，不阻断（让单张失败走原有 catch 路径，错误原因更明确）
      const emptyPromptItems = generateList.filter((i) => !i.prompt);
      if (emptyPromptItems.length > 0) {
        console.warn(
          `[batchGenerateImage] script=${scriptId} 有 ${emptyPromptItems.length} 个分镜 prompt 为空，` +
            `这些 sb 大概率会生图失败：${emptyPromptItems.map((i) => i.id).join(",")}`,
        );
      }
    }

    for (let i = 0; i < generateList.length; i += concurrentCount) {
      const batch = generateList.slice(i, i + concurrentCount);
      await Promise.all(batch.map(generateTask));
    }
  },
);
async function getAssetsImageBase64(imageIds: number[]) {
  if (!imageIds.length) return [];

  const imagePaths = await u.db("o_image").whereIn("o_image.id", imageIds).select("o_image.id", "o_image.filePath");

  // 建立 id 到 filePath 的映射
  const id2Path = new Map<number, string>();
  for (const row of imagePaths) {
    id2Path.set(row.id, row.filePath);
  }

  // 保证输出顺序与 imageIds 一致
  const imageUrls = await Promise.all(
    imageIds.map(async (id) => {
      const filePath = id2Path.get(id);
      if (filePath) {
        try {
          return await u.oss.getImageBase64(filePath);
        } catch {
          return null;
        }
      }
      return null;
    }),
  );
  // 保留顺序，并且过滤掉无效项
  return (imageUrls.filter(Boolean) as string[]).map((url) => ({ type: "image" as const, base64: url }));
}
