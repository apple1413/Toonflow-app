import express from "express";
import { success, error } from "@/lib/responseFormat";
import u from "@/utils";
import { z } from "zod";
import { validateFields } from "@/middleware/middleware";
import { userIdOf } from "@/utils/ownership";
import { upsertForUser } from "@/utils/perUserSetting";
const router = express.Router();

// 入参 id 是行 id（指向 admin 的默认行 或 当前用户已有的覆盖行）。
// 通过 id 反查 key，再以 (userId, key) 做 upsert——
//   - 用户已有该 key 的覆盖行：UPDATE
//   - 没有：INSERT 新行（不会动 admin 默认）
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
    const userId = userIdOf(req);
    const { id, name, model, modelName, vendorId, desc, temperature, maxOutputTokens } = req.body;
    const row = await u.db("o_agentDeploy").where({ id }).select("key", "userId").first();
    if (!row) return res.status(404).send(error("agent 配置不存在"));
    const ownerId = Number(row.userId);
    // 仅允许覆盖当前用户自己的行 或 admin 默认；不允许越权改别的用户的行
    if (ownerId !== userId && ownerId !== 1) return res.status(403).send(error("无权修改该 agent 配置"));
    await upsertForUser("o_agentDeploy", userId, { key: row.key }, {
      name, model, modelName, vendorId, desc, temperature, maxOutputTokens,
    });
    res.status(200).send(success("配置成功"));
  },
);
