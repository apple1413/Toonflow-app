import express from "express";
import { success, error } from "@/lib/responseFormat";
import u from "@/utils";
import { z } from "zod";
import { validateFields } from "@/middleware/middleware";
import { userIdOf } from "@/utils/ownership";
import { upsertForUser, getAdminUserId } from "@/utils/perUserSetting";
const router = express.Router();

// agent 模型部署全局共享：仅 admin 可写，所有租户共用同一份配置
// 入参 id 仍是行 id（用来反查 key），但写入永远落到 NULL 全局行
export default router.post(
  "/",
  validateFields({
    id: z.number(),
    name: z.string(),
    model: z.string(),
    modelName: z.string(),
    vendorId: z.string().nullable(),
    desc: z.string(),
    temperature: z.number().optional(),
    maxOutputTokens: z.number().optional(),
  }),
  async (req, res) => {
    await assertAdminAsync(req);
    const { id, name, model, modelName, vendorId, desc, temperature, maxOutputTokens } = req.body;
    const row = await u.db("o_agentDeploy").where({ id }).select("key").first();
    if (!row) return res.status(404).send(error("agent 配置不存在"));
    const ownerId = Number(row.userId);
    const adminUserId = await getAdminUserId();
    // 仅允许覆盖当前用户自己的行 或 admin 默认；不允许越权改别的用户的行。
    // 注意：admin id 在 Supabase 上是动态的（不再硬编码 1），所以走 getAdminUserId()。
    if (ownerId !== userId && ownerId !== adminUserId) return res.status(403).send(error("无权修改该 agent 配置"));
    await upsertForUser("o_agentDeploy", userId, { key: row.key }, {
      name, model, modelName, vendorId, desc, temperature, maxOutputTokens,
    });
    res.status(200).send(success("配置成功"));
  },
);
