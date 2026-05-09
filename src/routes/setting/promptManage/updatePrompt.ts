import express from "express";
import u from "@/utils";
import { z } from "zod";
import { success, error } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { userIdOf } from "@/utils/ownership";
import { upsertForUser } from "@/utils/perUserSetting";
const router = express.Router();

// 入参 id 是行 id（admin 默认行 或 当前用户已覆盖行）。通过 id 反查 (name, type) 业务键
// 后以 (userId, type) 做 upsert：用户已有覆盖 → UPDATE；否则 INSERT 新覆盖行（保留 admin 默认）。
export default router.post(
  "/",
  validateFields({
    id: z.number(),
  }),
  async (req, res) => {
    const userId = userIdOf(req);
    const { id, data } = req.body;
    const row = await u.db("o_prompt").where("id", id).select("name", "type", "data", "userId").first();
    if (!row) return res.status(404).send(error("提示词配置不存在"));
    const ownerId = Number(row.userId);
    if (ownerId !== userId && ownerId !== 1) return res.status(403).send(error("无权修改该提示词"));
    // 用 type 作为业务键。新建用户覆盖行时把 admin 的 name/data 一并复制过来，避免 fall-through 时缺字段
    await upsertForUser("o_prompt", userId, { type: row.type }, {
      name: row.name,
      data: row.data,
      useData: data,
    });
    res.status(200).send(success(123));
  },
);
