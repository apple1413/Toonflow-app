import express from "express";
import pLimit from "p-limit";
import u from "@/utils";
import { z } from "zod";
import { v4 as uuidv4 } from "uuid";
import { error, success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { userIdOf, assertOwnsProject, assertOwnsAssets } from "@/utils/ownership";
import { insertReturnId } from "@/utils/insertReturnId";
import { chargeForModel, refundCharge, estimateCostForModel, getBalance, InsufficientCreditsError } from "@/utils/credits";

const router = express.Router();

type AssetType = "role" | "scene" | "tool";

interface AssetTypeConfig {
  label: string;
  taskClass: string;
  dir: string;
  promptTitle: string;
  promptEnd: string;
}

const assetTypeConfig: Record<AssetType, AssetTypeConfig> = {
  role: {
    label: "角色",
    taskClass: "角色图生成",
    dir: "role",
    promptTitle: "角色标准四视图",
    promptEnd: "人物角色四视图",
  },
  scene: {
    label: "场景",
    taskClass: "场景图生成",
    dir: "scene",
    promptTitle: "标准场景图",
    promptEnd: "标准场景图",
  },
  tool: {
    label: "道具",
    taskClass: "道具图生成",
    dir: "props",
    promptTitle: "标准道具图",
    promptEnd: "标准道具图",
  },
};

function buildPrompt(cfg: AssetTypeConfig, artStyle: string, name: string, prompt: string): string {
  return `
    请根据以下参数生成${cfg.promptTitle}：

    **基础参数：**
    - 画风风格: ${artStyle || "未指定"}

    **${cfg.label}设定：**
    - 名称:${name},
    - 提示词:${prompt},

    请严格按照系统规范生成${cfg.promptEnd}。
  `;
}

const requestSchema = {
  projectId: z.number(),
  model: z.string(),
  resolution: z.string(),
  concurrentCount: z.number().int().min(1).optional(),
  items: z.array(
    z.object({
      id: z.number(),
      type: z.enum(["role", "scene", "tool", "storyboard"]),
      name: z.string(),
      prompt: z.string(),
      base64: z.string().optional().nullable(),
    }),
  ),
};

export default router.post("/", validateFields(requestSchema), async (req, res) => {
  const { projectId, model, resolution, concurrentCount, items } = req.body;
  const userId = userIdOf(req);
  await assertOwnsProject(userId, projectId);
  await assertOwnsAssets(userId, items.map((it: { id: number }) => it.id));

  // 1. 查询项目
  const project = await u.db("o_project").where("id", projectId).select("artStyle", "type", "intro").first();
  if (!project) return res.status(500).send(error("项目为空"));

  // 1.5 真实成本扣费：照分镜批量出图（batchGenerateImage.ts）那一套
  //   - 预检：先按 perImage × items.length 估总价，若余额不够直接 402 阻断
  //   - 实扣：每张图独立 task_id，AI 调用前扣、失败时按 task_id 退款（幂等）
  const userRow = await u.db("o_user").where({ id: userId }).select("externalId").first();
  const externalId = (userRow?.externalId as string) ?? "";
  const [imgVendor, imgModelName] = String(model ?? "").split(/:(.+)/);
  if (externalId && imgVendor && imgModelName && items.length > 0) {
    const perImageCost = await estimateCostForModel(imgVendor, imgModelName, "image", {
      size: resolution,
      count: 1,
    });
    const totalEstimate = perImageCost * items.length;
    if (totalEstimate > 0) {
      const balance = await getBalance(externalId);
      if (balance >= 0 && balance < totalEstimate) {
        return res.status(402).send(
          error(`积分不足：本次需要 ${totalEstimate}（${items.length} 张 × ${perImageCost}/张），剩余 ${balance}`),
        );
      }
    }
  }

  // 2. 逐条插入 o_image 占位记录，收集 imageId 列表
  const totalNovelId: number[] = [];
  for (const item of items) {
    const imageId = await insertReturnId("o_image", {
      type: item.type,
      state: "生成中",
      assetsId: item.id,
    });
    await u.db("o_assets").where("id", item.id).update({ imageId });
    totalNovelId.push(imageId);
  }

  // 3. 后台异步并发生成，不阻塞响应
  const limit = pLimit(concurrentCount ?? 1);

  const tasks = items.map((item: { id: number; type: string; name: string; prompt: string; base64: string | null | undefined }, index: number) =>
    limit(async () => {
      const imageId = totalNovelId[index];
      const data = await u.db("o_image").where("id", imageId).select("state").first();
      if (data?.state === "生成失败") {
        return;
      }
      const cfg = assetTypeConfig[item.type as AssetType];
      if (!cfg) return;

      await u.db("o_assets").where("id", item.id).update({ imageId });

      const imagePath = `/${projectId}/${cfg.dir}/${uuidv4()}.jpg`;
      const userPrompt = buildPrompt(cfg, project.artStyle ?? "", item.name, item.prompt);
      const describe = `生成${cfg.label}图，名称：${item.name}，提示词：${item.prompt}`;
      const relatedObjects = { id: item.id, projectId, type: cfg.label };

      // 每张图独立 task_id（便于失败时按 task 退款；mixvoice trans_no 列实测上限 ~40 字符）
      const perImageTaskId = `tfag_${item.id}_${imageId}_${Date.now().toString(36)}`;
      let charged = 0;
      // per-image 扣费：余额已 pre-flight，理论上不会 402；真 402 直接标失败
      if (externalId && imgVendor && imgModelName) {
        try {
          const r = await chargeForModel({
            userExternalId: externalId,
            vendor: imgVendor,
            model: imgModelName,
            kind: "image",
            input: { size: resolution, count: 1 },
            taskId: perImageTaskId,
            fallbackScene: "image_generation",
          });
          charged = r.charged;
        } catch (e: any) {
          if (e instanceof InsufficientCreditsError) {
            await u.db("o_image").where("id", imageId).update({
              state: "生成失败",
              errorReason: `积分不足：需要 ${e.required}，剩余 ${e.remaining}`,
            });
            return;
          }
          console.error(`[batchGenerateImageAssets] charge 失败 asset=${item.id}`, e);
          await u.db("o_image").where("id", imageId).update({
            state: "生成失败",
            errorReason: `扣费失败: ${u.error(e).message}`,
          });
          return;
        }
      }

      try {
        const aiImage = u.Ai.Image(model);
        await aiImage.run(
          {
            prompt: userPrompt,
            referenceList: item.base64 ? [{ base64: item.base64, type: "image" }] : [],
            size: resolution,
            aspectRatio: "16:9",
          },
          {
            taskClass: cfg.taskClass,
            describe,
            projectId,
            relatedObjects: JSON.stringify(relatedObjects),
          },
        );
        aiImage.save(imagePath);

        const imageData = await u.db("o_image").where("id", imageId).select("*").first();
        if (!imageData) return res.status(500).send("资产已被删除");
        if (!imageData) return;
        if (imageData.state === "生成失败") return;
        await u
          .db("o_image")
          .where("id", imageId)
          .update({
            state: "已完成",
            filePath: imagePath,
            type: item.type,
            model: model.split(/:(.+)/)[1],
            resolution,
          });

        await u.db("o_assets").where("id", item.id).update({ imageId });
      } catch (e: any) {
        await u
          .db("o_image")
          .where("id", imageId)
          .update({ state: "生成失败", errorReason: u.error(e).message });
        // 生成失败按 task_id 退款（幂等）；charged===0 时跳过
        if (charged > 0) {
          await refundCharge({
            userExternalId: externalId,
            taskId: perImageTaskId,
            reason: `image failed: ${u.error(e).message}`,
          });
        }
      }
    }),
  );

  // 后台执行，不等待结果
  Promise.all(tasks).catch(() => {});

  return res.status(200).send(success({ total: items.length }));
});
